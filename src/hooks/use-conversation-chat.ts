'use client'
/**
 * Modo CONVERSA (#60) — o CÉREBRO client do chat, extraído (S1 de #104) do componente
 * `conversation-experience.tsx` como hook container-agnóstico. Segura TODA a máquina de
 * estados, refs e ações do chat com streaming + destilação; o componente que o consome vira
 * um wrapper fino que só renderiza a JSX a partir do "bag" retornado.
 *
 * Este hook performs NO auth (ADR-0011 is the caller's responsibility) and OWNS the abort/mount
 * lifecycle (consumers run no cleanup on returned refs). Não chama `useLocale()` nem
 * `useSession()` — o locale entra por parâmetro e a autenticação/guards ficam no caller.
 *
 * ADR-0009/0010: a UI consome os ROUTE HANDLERS via `fetch` (NÃO Server Actions) e NÃO
 * reimplementa domínio. O transporte é NDJSON em streaming:
 *  - `POST /api/creation-sessions` → `{sessionId}` no INÍCIO de uma conversa NOVA (a UI segura
 *    o id para retomar/apagar). Na retomada, o id vem da rota (`/conversation/[id]`).
 *  - `POST /api/conversations/stream` body `{transcript, sessionId}` → ReadableStream NDJSON:
 *    zero-ou-mais `{type:'token',text}` e DEPOIS EXATAMENTE UM terminal:
 *      `{type:'recipe',outcome,recipeId,advisory,avisos?}` | `{type:'impossible',advisory}`
 *      | `{type:'error',error:'geracao_invalida'|'conflito_concorrente'}`.
 *    A cada turno a UI anexa a fala do Usuário ao transcript LOCAL e posta o transcript
 *    INTEIRO + o sessionId segurado. A última fala É do Usuário (parseTranscript exige).
 *  - O frame `recipe` traz só `recipeId` (NÃO o corpo) → 2º `GET /api/recipes/{id}?locale=`
 *    para renderizar (idêntico ao `carregarReceita` da tela CRIAR).
 *
 * DUAS falhas DISTINTAS (NÃO conflar):
 *  - `{type:'error'}` (frame terminal de erro) → erro de sistema neutro + CTA RE-DESTILAR.
 *  - stream fecha SEM frame terminal (queda de conexão) → aviso de QUEDA + CTA RETOMAR/TENTAR.
 *
 * Salvar a Receita destilada REUSA a #59 (navega pro detalhe onde moram os controles de
 * Visibilidade) — NUNCA re-gera (a Receita já está persistida private na destilação).
 */
import { useEffect, useRef, useState } from 'react'
import type { Locale } from '@/i18n/locale'
import type { RecipeView, AvisoView } from '@/domain/recipe-read'

/** Uma fala do transcript LOCAL (o servidor atribui `seq`; a UI guarda role+content). */
export type ChatMessage = { role: 'user' | 'assistant'; content: string }

/** Frames do contrato NDJSON (espelham o route handler). */
type TokenFrame = { type: 'token'; text: string }
type TerminalFrame =
  | {
      type: 'recipe'
      outcome: 'success' | 'degraded' | 'playful'
      recipeId: string | null
      advisory: string | null
      avisos?: AvisoView[]
    }
  | { type: 'impossible'; advisory: string | null }
  | { type: 'error'; error: 'geracao_invalida' | 'conflito_concorrente' }
type Frame = TokenFrame | TerminalFrame

/** Resultado da destilação (terminal `recipe`/`impossible`), espelhando a tela CRIAR. */
export type DistillResult =
  | {
      outcome: 'success' | 'degraded' | 'playful'
      recipeId: string | null
      advisory: string | null
      avisos?: AvisoView[]
    }
  | { outcome: 'impossible'; advisory: string | null }

/**
 * Estado do TURNO em voo / do último desfecho. `idle` (pronto p/ digitar), `streaming`
 * (tokens chegando), `distilling` (loop fechou, frame terminal ainda não chegou — em prática o
 * terminal vem logo após o último token, mas o rótulo dá feedback), `result` (terminal
 * recipe/impossible processado), `error` (frame terminal de erro), `dropped` (stream fechou SEM
 * terminal — queda). `streaming`/`distilling` travam o input.
 */
export type Status = 'idle' | 'streaming' | 'distilling' | 'result' | 'error' | 'dropped'

/** Type-guard de frame bem-formado lido de uma linha NDJSON. */
function isFrame(v: unknown): v is Frame {
  return typeof v === 'object' && v !== null && 'type' in v
}

/** O "bag" devolvido ao caller — tudo o que a JSX do chat precisa para renderizar e agir. */
export type ConversationChat = {
  // Estado
  transcript: ChatMessage[]
  sessionId: string | null
  input: string
  status: Status
  liveAssistant: string
  result: DistillResult | null
  view: RecipeView | null
  errorKey: 'geracao_invalida' | 'conflito_concorrente' | 'limite_geracao' | null
  loadFailed: boolean
  deleteOpen: boolean
  deleteError: boolean
  resuming: boolean
  resumeFailed: boolean
  inFlight: boolean
  // Setters expostos à JSX (input controlado + abrir/fechar diálogo + retry de status)
  setInput: (v: string) => void
  setStatus: (s: Status) => void
  setDeleteOpen: (v: boolean) => void
  // Refs de foco (a11y) — gerência de foco fica na JSX
  headingRef: React.RefObject<HTMLHeadingElement | null>
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  dialogRef: React.RefObject<HTMLDivElement | null>
  deleteTriggerRef: React.MutableRefObject<HTMLElement | null>
  // Ações / handlers
  carregarReceita: (
    distill: Extract<DistillResult, { recipeId: string | null }>,
  ) => Promise<void>
  fecharDialogo: () => void
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  redestilar: () => void
  confirmarApagar: () => Promise<void>
  novaConversa: () => void
}

/**
 * Container-agnostic brain do Modo Conversa. Recebe o `locale` (resolvido pelo caller) e o
 * `resumeSessionId` opcional (vindo da rota de retomada). Devolve o estado, as refs de foco e
 * todos os handlers como um único objeto.
 */
export function useConversationChat({
  locale,
  resumeSessionId,
}: {
  locale: Locale
  resumeSessionId?: string
}): ConversationChat {
  // Transcrição LOCAL (cresce a cada turno). O sessionId é segurado p/ retomar/apagar: vem do
  // POST /api/creation-sessions no 1º turno de uma conversa NOVA, ou da rota na retomada.
  const [transcript, setTranscript] = useState<ChatMessage[]>([])
  const [sessionId, setSessionId] = useState<string | null>(resumeSessionId ?? null)
  const [input, setInput] = useState('')

  const [status, setStatus] = useState<Status>('idle')
  // Bolha do Assistente em construção (tokens acumulados) durante o streaming — renderizada
  // INCREMENTALMENTE, separada do transcript commitado (só vira fala fixa quando o turno fecha).
  const [liveAssistant, setLiveAssistant] = useState('')

  const [result, setResult] = useState<DistillResult | null>(null)
  const [view, setView] = useState<RecipeView | null>(null)
  const [errorKey, setErrorKey] = useState<
    'geracao_invalida' | 'conflito_concorrente' | 'limite_geracao' | null
  >(null)
  // Receita FOI destilada (recipeId não-null) mas o 2º GET do corpo falhou — "criada mas não
  // carregou" (NÃO 'impossible'; reenviar duplicaria a geração). Espelha a tela CRIAR.
  const [loadFailed, setLoadFailed] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState(false)

  // Retomada (#15): GET /api/creation-sessions/[id] reidrata transcript + Receita + advisory.
  const [resuming, setResuming] = useState<boolean>(Boolean(resumeSessionId))

  // Retomada falhou (404 do GET — Session inexistente/expirada ou não-pertencente): em vez de
  // um chat vazio/quebrado, mostra uma mensagem clara + saída para uma conversa nova.
  const [resumeFailed, setResumeFailed] = useState(false)

  // Foco no swap de estado (a11y): o foco do teclado não pode cair no <body> quando a região
  // de resultado troca. Movemos o foco para o heading do estado novo.
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  // Diálogo de apagar (#15): container (p/ trap de Tab) + elemento que o abriu (p/ devolver o
  // foco ao fechar). Sem isso o foco do teclado fica preso atrás do modal.
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const deleteTriggerRef = useRef<HTMLElement | null>(null)

  // Ciclo de vida do stream (espelha search-experience.tsx): o AbortController da requisição
  // de stream em voo (cancelado no unmount) e um flag de montagem para guardar TODO setState
  // do loop — sem isso, navegar para fora no meio do stream vaza "setState em componente
  // desmontado". `mountedRef` é true do mount ao unmount; o cleanup effect aborta+desmarca.
  // PRIVADOS ao hook: não são retornados (o caller NÃO roda cleanup neles).
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  const inFlight = status === 'streaming' || status === 'distilling'

  // ── Retomada (#15) ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!resumeSessionId) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(
          `/api/creation-sessions/${resumeSessionId}?locale=${encodeURIComponent(locale)}`,
        )
        // 404 (Session inexistente/expirada ou de OUTRO dono) → não há o que reidratar: sinaliza
        // a falha de retomada (mostra mensagem clara + saída) em vez de um chat vazio quebrado.
        if (!r.ok) {
          if (!cancelled) setResumeFailed(true)
          return
        }
        const data = (await r.json()) as {
          transcript?: ChatMessage[]
          recipe?: RecipeView | null
          advisory?: string | null
        }
        if (cancelled) return
        const msgs = (data.transcript ?? []).map((t) => ({ role: t.role, content: t.content }))
        setTranscript(msgs)
        // Guard: `resultKind` SÓ existe quando há Receita. Retomada PRÉ-destilação tem
        // `recipe=null` (conversa em andamento, ainda sem desfecho) — não reconstrói `outcome`.
        if (data.recipe) {
          setView(data.recipe)
          // Reconstrói o desfecho a partir de `resultKind` da Receita (a view do dono o traz).
          const kind = data.recipe.resultKind
          const outcome: DistillResult['outcome'] =
            kind === 'degraded' ? 'degraded' : kind === 'playful' ? 'playful' : 'success'
          setResult({ outcome, recipeId: data.recipe.id, advisory: data.advisory ?? null })
          // Mostra a Receita reidratada (a região de resultado é gateada por status==='result').
          setStatus('result')
        }
      } catch {
        // Rede/parse: mesma falha de retomada (mensagem clara, não um chat vazio).
        if (!cancelled) setResumeFailed(true)
      } finally {
        if (!cancelled) setResuming(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // Só na montagem (a retomada é uma vez); `locale` é estável pela navegação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeSessionId])

  // Foco no heading quando o estado muda de forma significativa.
  useEffect(() => {
    if (status === 'result' || status === 'error' || status === 'dropped') {
      headingRef.current?.focus()
    }
  }, [status])

  // Diálogo de apagar — gestão de foco (a11y): ao FECHAR, devolve o foco ao elemento que abriu
  // (o foco-on-OPEN é via `autoFocus` no botão primário). O trap de Tab e o Escape ficam no
  // `onKeyDown` do container do diálogo (na JSX do caller).
  const fecharDialogo = () => {
    setDeleteOpen(false)
    setDeleteError(false)
    deleteTriggerRef.current?.focus()
    deleteTriggerRef.current = null
  }

  /**
   * Garante um sessionId para uma conversa NOVA: POST /api/creation-sessions → `{sessionId}`.
   * Na retomada o id já existe (vem da rota). Falha de criação NÃO bloqueia o turno — o stream
   * faz lazy-create da Session; mas guardamos o id quando dá, p/ retomar/apagar funcionarem.
   */
  async function ensureSessionId(): Promise<string | null> {
    if (sessionId) return sessionId
    try {
      const r = await fetch('/api/creation-sessions', { method: 'POST' })
      if (r.ok) {
        const { sessionId: id } = (await r.json()) as { sessionId: string }
        setSessionId(id)
        return id
      }
    } catch {
      // Ignora — o stream faz lazy-create; só perdemos a alça de retomar/apagar este turno.
    }
    return null
  }

  /**
   * 2º GET do corpo da Receita destilada (RecipeView CRU). Merge defensivo de `avisos` (se o
   * frame trouxe e o GET não). Falha → `loadFailed` (NÃO 'impossible'). Espelha a tela CRIAR.
   */
  async function carregarReceita(distill: Extract<DistillResult, { recipeId: string | null }>) {
    if (distill.recipeId == null) {
      setLoadFailed(true)
      setStatus('result')
      return
    }
    try {
      const r = await fetch(
        `/api/recipes/${distill.recipeId}?locale=${encodeURIComponent(locale)}`,
      )
      if (r.ok) {
        const v = (await r.json()) as RecipeView
        // Merge defensivo (ADR-0004): se o frame trouxe avisos e o GET não, preserva-os.
        setView(v.avisos ? v : { ...v, avisos: distill.avisos })
        setLoadFailed(false)
      } else {
        setView(null)
        setLoadFailed(true)
      }
    } catch {
      setView(null)
      setLoadFailed(true)
    }
    setStatus('result')
  }

  /**
   * Processa o frame terminal: ramifica por tipo (espelha o pipeline da tela CRIAR). `base` é o
   * transcript ATÉ a fala do Usuário (sem a do Assistente); `assistantText` é a bolha acumulada.
   *
   * COMMIT da fala do Assistente: SÓ em terminal de SUCESSO (recipe/impossible). No frame de
   * ERRO o transcript LOCAL fica terminando em 'user' — assim o CTA "Destilar de novo" pode
   * re-POSTar um transcript VÁLIDO (parseTranscript exige última fala = 'user'). No servidor as
   * 2 falas JÁ foram persistidas no turno; o local só guarda o que permite re-destilar.
   */
  async function handleTerminal(frame: TerminalFrame, base: ChatMessage[], assistantText: string) {
    if (frame.type === 'error') {
      // NÃO commita a fala do Assistente: o transcript local segue terminando em 'user'.
      setTranscript(base)
      setLiveAssistant('')
      setErrorKey(frame.error)
      setStatus('error')
      return
    }
    // Terminais de sucesso: commita a fala do Assistente acumulada.
    setTranscript([...base, { role: 'assistant', content: assistantText }])
    setLiveAssistant('')
    if (frame.type === 'impossible') {
      setResult({ outcome: 'impossible', advisory: frame.advisory })
      setView(null)
      setStatus('result')
      return
    }
    // recipe (success | degraded | playful)
    const distill: DistillResult = {
      outcome: frame.outcome,
      recipeId: frame.recipeId,
      advisory: frame.advisory,
      avisos: frame.avisos,
    }
    setResult(distill)
    setLoadFailed(false)
    await carregarReceita(distill)
  }

  /**
   * Núcleo do turno: anexa a fala do Usuário ao transcript LOCAL, posta o transcript INTEIRO +
   * o sessionId, e lê o NDJSON via `getReader()` + `TextDecoder` + buffer de linhas (mantém o
   * TAIL parcial entre reads). Tokens acumulam na bolha viva; o frame terminal ramifica. Se o
   * stream fecha SEM terminal → estado `dropped` (queda), DISTINTO do frame de erro.
   */
  async function streamFrom(t: ChatMessage[], id: string | null) {
    let sawTerminal = false
    // AbortController por chamada (espelha search-experience): aborta o anterior em voo (re-
    // destilar/retomar) e o cleanup do unmount aborta o atual. Passado como `signal` ao fetch.
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    try {
      const res = await fetch('/api/conversations/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transcript: t, sessionId: id ?? undefined }),
        signal: controller.signal,
      })

      // #167: teto diário de geração estourado → 429 limite_geracao JSON ANTES do stream (custo
      // barrado, headers ainda não enviados). É um desfecho LIMPO (não queda): mostra a mensagem
      // amigável de limite com CTA de tentar mais tarde, distinta da queda ambígua de conexão.
      if (res.status === 429) {
        if (mountedRef.current) {
          setLiveAssistant('')
          setErrorKey('limite_geracao')
          setStatus('error')
        }
        return
      }

      // Falhas PRÉ-stream (401 auth / 400 shape): JSON normal, sem corpo de stream → queda.
      if (!res.ok || !res.body) {
        if (mountedRef.current) setStatus('dropped')
        return
      }

      reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let assistantText = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // Divide em linhas COMPLETAS; o tail parcial (sem '\n') fica no buffer p/ o próximo read.
        let nl: number
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (line === '') continue
          let frame: unknown
          try {
            frame = JSON.parse(line)
          } catch {
            // Linha COMPLETA mas inválida: ignora (defensivo). Avisa no dev p/ visibilidade.
            console.warn('[conversation] linha NDJSON malformada:', line)
            continue
          }
          if (!isFrame(frame)) continue
          // Componente desmontou no meio do stream: pára de aplicar estado (evita setState em
          // componente desmontado). O `finally` libera o reader.
          if (!mountedRef.current) return
          if (frame.type === 'token') {
            assistantText += frame.text
            setLiveAssistant(assistantText)
          } else {
            // Frame terminal: o turno do chat fechou. `handleTerminal` decide o commit da fala
            // do Assistente (só em sucesso) e ramifica (recipe/impossible → 'result'; error →
            // 'error'). `distilling` dá feedback enquanto o 2º GET (corpo da Receita) corre.
            sawTerminal = true
            setStatus('distilling')
            await handleTerminal(frame, t, assistantText)
          }
        }
      }

      // Stream fechou SEM frame terminal → QUEDA (distinta do frame de erro). NÃO commita a fala
      // PARCIAL do Assistente (#203): o transcript LOCAL fica como `t`, terminando em 'user' — assim
      // `redestilar` re-POSTa um transcript VÁLIDO (parseTranscript exige última fala = 'user') sem
      // 400 (`ultima_fala_nao_usuario`). O texto parcial some (a destilação não concluiu; o servidor
      // já persistiu o que houve).
      if (!sawTerminal && mountedRef.current) {
        setLiveAssistant('')
        setStatus('dropped')
      }
    } catch (err) {
      // ABORT NOSSO (unmount/navegação/re-destilar): NÃO é queda nem erro — só pára. Distingue
      // de uma queda de conexão real (que cai no `dropped`). O guard de montagem já torna isso
      // inócuo no unmount, mas o teste explícito protege um futuro caller que aborte em voo.
      if (err instanceof DOMException && err.name === 'AbortError') return
      // Erro de rede / leitura interrompida de verdade: trata como queda (retomar/tentar).
      if (!sawTerminal && mountedRef.current) {
        setLiveAssistant('')
        setStatus('dropped')
      }
    } finally {
      // Libera o stream em QUALQUER saída (sucesso, queda, abort, erro).
      reader?.cancel().catch(() => {})
    }
  }

  /**
   * Inicia um turno NOVO: anexa a fala do Usuário ao transcript LOCAL e abre o stream. Conversa
   * NOVA garante a Session ANTES de postar (alça de retomar/apagar); na retomada o id já existe.
   */
  async function enviarTurno(text: string) {
    const nextTranscript: ChatMessage[] = [...transcript, { role: 'user', content: text }]
    setTranscript(nextTranscript)
    setInput('')
    setStatus('streaming')
    setLiveAssistant('')
    setErrorKey(null)
    setLoadFailed(false)
    const id = await ensureSessionId()
    await streamFrom(nextTranscript, id)
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (inFlight) return // evita re-entrada / turno duplicado
    const text = input.trim()
    if (text === '') return
    void enviarTurno(text)
  }

  // Enter envia; Shift+Enter quebra linha (convenção de chat).
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const text = input.trim()
      if (!inFlight && text !== '') void enviarTurno(text)
    }
  }

  /**
   * Re-destila / retoma: reenvia o transcript ATUAL como está (a última fala já é do Usuário no
   * caminho de erro/queda — a fala do Assistente do turno falho NÃO foi commitada após erro). É
   * a MESMA máquina para o CTA de re-destilar (frame de erro) e o de retomar (queda).
   */
  function redestilar() {
    if (inFlight || transcript.length === 0) return
    setStatus('streaming')
    setLiveAssistant('')
    setErrorKey(null)
    void (async () => {
      const id = await ensureSessionId()
      await streamFrom(transcript, id)
    })()
  }

  /**
   * Apaga a Transcrição (#15, IRREVERSÍVEL): DELETE /api/creation-sessions/[id]/transcript.
   * Mantém a Receita renderizada + o link de salvar; só zera a conversa localmente.
   */
  async function confirmarApagar() {
    if (!sessionId) {
      setDeleteOpen(false)
      return
    }
    setDeleteError(false)
    try {
      const r = await fetch(`/api/creation-sessions/${sessionId}/transcript`, { method: 'DELETE' })
      if (!r.ok) {
        // Falha → mantém o diálogo aberto com a mensagem de erro (o foco fica no diálogo).
        setDeleteError(true)
        return
      }
      setTranscript([])
      setLiveAssistant('')
      setErrorKey(null)
      setDeleteOpen(false)
      // O botão que abriu o diálogo SOME (transcript zerado) → devolver foco a ele perderia o
      // foco no <body>; manda para o heading do estado resultante (a11y).
      deleteTriggerRef.current = null
      headingRef.current?.focus()
      // MANTÉM `view`/`result` (a Receita continua salva) + o link de salvar.
      if (view) setStatus('result')
      else setStatus('idle')
    } catch {
      setDeleteError(true)
    }
  }

  /** Nova conversa: zera tudo (transcript, Session, Receita) e volta pro idle. */
  function novaConversa() {
    setTranscript([])
    setSessionId(null)
    setInput('')
    setLiveAssistant('')
    setResult(null)
    setView(null)
    setErrorKey(null)
    setLoadFailed(false)
    setDeleteOpen(false)
    setStatus('idle')
    inputRef.current?.focus()
  }

  return {
    transcript,
    sessionId,
    input,
    status,
    liveAssistant,
    result,
    view,
    errorKey,
    loadFailed,
    deleteOpen,
    deleteError,
    resuming,
    resumeFailed,
    inFlight,
    setInput,
    setStatus,
    setDeleteOpen,
    headingRef,
    inputRef,
    dialogRef,
    deleteTriggerRef,
    carregarReceita,
    fecharDialogo,
    onSubmit,
    onKeyDown,
    redestilar,
    confirmarApagar,
    novaConversa,
  }
}
