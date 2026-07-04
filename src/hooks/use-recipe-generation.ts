'use client'
/**
 * Motor CLIENT compartilhado da geração de Receita por IA (#193, extraído do
 * `create-structured-experience.tsx`). Segura a MÁQUINA DE RESULTADO comum aos vários caminhos de
 * criação (estruturado da /create, prompt aberto, e o wizard estruturado do drawer #191/#193): o
 * POST em `/api/generations`, o 2º GET do corpo da Receita, e os estados loading/result/error/
 * cap/load-failed. NÃO conhece o BRIEFING — cada caminho monta o seu próprio `body` e chama
 * `enviar(body)`. Container-agnóstico (padrão de `useConversationChat`): o locale entra por
 * parâmetro, a autenticação/guards ficam no caller, e o callback `onLoadingChange` (ADITIVO)
 * espelha `status === 'loading'` para o shell-drawer travar o dismiss enquanto a geração corre.
 *
 * ADR-0010: consome os ROUTE HANDLERS via `fetch` (NÃO Server Actions) e NÃO reimplementa regra de
 * domínio — o servidor revalida TUDO; a Receita renderizada é o que a rota devolve, lido CRU do
 * body. DUAS chamadas (descoberta da #58): o POST devolve só `{ outcome, recipeId, advisory,
 * avisos? }`; em success/degraded/playful fazemos um SEGUNDO `GET /api/recipes/{id}?locale=`
 * (mesma origem → cookie de sessão junto → o dono lê a própria Receita privada).
 *
 * #167: 429 `limite_geracao` → mensagem amigável de janela (não erro cru), checada ANTES da IA →
 * nunca consome cap nem toca o GET. O foco-no-swap (a11y) move o teclado para o `headingRef` do
 * estado novo — o caller pendura essa ref no heading do topo do seu resultado.
 */
import { useEffect, useRef, useState } from 'react'
import type { Locale } from '@/i18n/locale'
import type { RecipeView, AvisoView } from '@/domain/recipe-read'
import type { Messages } from '@/i18n/messages'

// #423: 'choice' = as 2 variações chegaram e o usuário ainda vai escolher; converge p/ 'result'.
export type Status = 'idle' | 'loading' | 'result' | 'error' | 'choice'

export type GenerationResult = {
  outcome: 'success' | 'degraded' | 'playful' | 'impossible'
  recipeId?: string | null
  advisory: string | null
  avisos?: AvisoView[]
  // #231 (ADR-0020): slug + locale CONGELADOS na criação (do 201 de /api/generations), pros
  // componentes de resultado montarem o link canônico `/{locale}/recipes/<slug>`. AUSENTES no
  // `impossible` (sem Receita) ou quando o slug ainda não congelou — o link cai no fallback por UUID.
  slug?: string
  locale?: string
}

/**
 * Mapa CÓDIGO de validação (do handler) → chave de `messages.criar`. Casa por código; NUNCA
 * exibe a mensagem crua do servidor. Compartilhado por todos os caminhos de criação.
 */
export function mapErroMensagem(m: Messages['criar'], errorKey: string): string {
  switch (errorKey) {
    case 'briefing_vazio':
      return m.erroBriefingVazio
    case 'porcoes_fora_de_faixa':
      return m.erroPorcoes
    case 'dificuldade_fora_de_faixa':
      return m.erroDificuldade
    case 'observacoes_muito_longas':
      return m.erroObservacoesLongas
    case 'free_text_vazio':
      return m.erroTextoVazio
    case 'free_text_muito_longo':
      return m.erroTextoMuitoLongo
    case 'ingrediente_inexistente':
    case 'item_sem_identidade':
    case 'unidade_invalida':
    case 'strength_invalida':
    case 'erroIngrediente':
      return m.erroIngrediente
    case 'cozinha_invalida':
    case 'restricao_invalida':
    case 'briefing_invalido':
      return m.erroCampos
    case 'erroGeracao':
      return m.erroGeracao
    case 'erroConexao':
      return m.erroConexao
    // #167: teto diário de geração por papel (429 limite_geracao) → mensagem amigável.
    case 'limite_geracao':
    case 'erroLimiteGeracao':
      return m.erroLimiteGeracao
    // #423: "gerar 2" pediu 2 slots mas o teto não tem espaço p/ ambos → mensagem específica.
    case 'limite_geracao_variacao':
      return m.erroLimiteVariacao
    default:
      return m.erroCampos
  }
}

/**
 * #423 — uma das 2 variações do lote "gerar 2, o usuário escolhe", já com o corpo (`view`) buscado. O
 * `generationId` é o alvo SERVER-AUTHORITATIVE da escolha (POST /api/generations/choice); o resto monta
 * a coluna (rótulo do pólo) e a convergência p/ o resultado quando o usuário pica uma.
 */
export type VariantChoice = {
  recipeId: string
  slug?: string
  locale?: string
  label: string
  generationId: string
  outcome: 'success' | 'degraded' | 'playful'
  advisory: string | null
  view: RecipeView | null
}

export type RecipeGenerationEngine = {
  status: Status
  result: GenerationResult | null
  view: RecipeView | null
  errorKey: string | null
  loadFailed: boolean
  // #423: as 2 variações (com corpo) quando `status === 'choice'`; null fora disso.
  variants: VariantChoice[] | null
  headingRef: React.RefObject<HTMLHeadingElement | null>
  /** Posta o `body` em /api/generations e converge para result/choice/error (sem montar o body aqui). */
  enviar: (body: unknown) => Promise<void>
  /** Re-busca o corpo de uma Receita JÁ criada (botão "tentar carregar de novo"). */
  carregarReceita: (generation: GenerationResult) => Promise<void>
  /** #423: registra a escolha (server-authoritative, owner-scope) e converge p/ o resultado da escolhida. */
  escolherVariante: (v: VariantChoice) => Promise<void>
  /** Volta ao estado idle (limpando ou não o erro/resultado). O caller zera o seu próprio Briefing. */
  voltarParaIdle: () => void
  setStatus: (s: Status) => void
  setErrorKey: (k: string | null) => void
}

export function useRecipeGeneration({
  locale,
  onLoadingChange,
}: {
  locale: Locale
  onLoadingChange?: (loading: boolean) => void
}): RecipeGenerationEngine {
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [view, setView] = useState<RecipeView | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  // A Receita FOI criada (POST ok, recipeId não-null) mas o GET do corpo falhou. NÃO é o
  // mesmo que 'impossible' (lá não há Receita): aqui dizemos "criada, mas não carregou".
  const [loadFailed, setLoadFailed] = useState(false)
  // #423: as 2 variações (com corpo) quando o POST devolve `outcome:'variants'`.
  const [variants, setVariants] = useState<VariantChoice[] | null>(null)

  const headingRef = useRef<HTMLHeadingElement | null>(null)

  /** Busca o corpo (RecipeView CRU) de uma Receita por id; null em não-ok/erro. Reuso interno (#423). */
  async function fetchView(recipeId: string): Promise<RecipeView | null> {
    try {
      const r = await fetch(`/api/recipes/${recipeId}?locale=${encodeURIComponent(locale)}`)
      if (!r.ok) return null
      return (await r.json()) as RecipeView
    } catch {
      return null
    }
  }

  async function carregarReceita(generation: GenerationResult) {
    if (generation.recipeId == null) {
      setLoadFailed(true)
      setStatus('result')
      return
    }
    try {
      const r = await fetch(
        `/api/recipes/${generation.recipeId}?locale=${encodeURIComponent(locale)}`,
      )
      if (r.ok) {
        const v = (await r.json()) as RecipeView
        // Merge defensivo (ADR-0004): se o POST trouxe avisos e o GET não, preserva-os.
        setView(v.avisos ? v : { ...v, avisos: generation.avisos })
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

  async function enviar(body: unknown) {
    setStatus('loading')
    try {
      const res = await fetch('/api/generations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.status === 400) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setErrorKey(data.error ?? 'erroCampos')
        setStatus('error')
        return
      }
      // #167: teto estourado → 429 limite_geracao. Mensagem AMIGÁVEL, sem travar o formulário.
      // #423: "gerar 2" sem 2 slots → 429 limite_geracao_variacao (chave DISTINTA, mensagem própria).
      // Propaga a chave conhecida INTACTA p/ o mapErroMensagem; só o desconhecido cai em erroGeracao.
      if (res.status === 429) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setErrorKey(
          data.error === 'limite_geracao' || data.error === 'limite_geracao_variacao'
            ? data.error
            : 'erroGeracao',
        )
        setStatus('error')
        return
      }
      if (!res.ok) {
        // 502 (outcome:'invalid') e qualquer outro não-ok caem em erro de geração neutro.
        setErrorKey('erroGeracao')
        setStatus('error')
        return
      }

      const data = (await res.json()) as
        | GenerationResult
        | {
            outcome: 'variants'
            variants: Omit<VariantChoice, 'view'>[]
          }

      // #423: "gerar 2, o usuário escolhe" → busca o corpo das 2 Receitas EM PARALELO e entra em 'choice'.
      // Se algum GET falhar, o corpo daquela coluna fica null (a região de escolha degrada a coluna, sem
      // derrubar a outra). NÃO consome result/view — a convergência acontece só ao escolher.
      if (data.outcome === 'variants') {
        const withViews = await Promise.all(
          data.variants.map(async (v) => ({ ...v, view: await fetchView(v.recipeId) })),
        )
        setVariants(withViews)
        setResult(null)
        setView(null)
        setLoadFailed(false)
        setStatus('choice')
        return
      }

      setResult(data)
      setVariants(null)
      setLoadFailed(false)

      if (data.outcome === 'impossible') {
        // Hard-stop honesto: sem Receita, sem GET.
        setView(null)
        setStatus('result')
        return
      }

      // success | degraded | playful → busca o corpo da Receita (RecipeView CRU).
      await carregarReceita(data)
    } catch {
      setErrorKey('erroConexao')
      setStatus('error')
    }
  }

  /**
   * #423 — registra a escolha de UMA variação e converge para o resultado dela. A escolha é
   * SERVER-AUTHORITATIVE (owner-scope): postamos o `generationId` em /api/generations/choice e o servidor
   * prova a posse. Em falha (404/rede), NÃO trava a tela — a variação escolhida JÁ está persistida
   * (privada); convergimos para o resultado dela mesmo assim (o carimbo do sinal é best-effort). Reusa o
   * `view` já buscado (sem 2º GET).
   */
  async function escolherVariante(v: VariantChoice) {
    // Best-effort: o sinal comportamental não pode bloquear a convergência da UI.
    try {
      await fetch('/api/generations/choice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ generationId: v.generationId }),
      })
    } catch {
      // ignora — a escolhida já existe; convergimos abaixo de qualquer forma.
    }
    setResult({
      outcome: v.outcome,
      recipeId: v.recipeId,
      advisory: v.advisory,
      ...(v.slug != null ? { slug: v.slug } : {}),
      ...(v.locale != null ? { locale: v.locale } : {}),
    })
    setView(v.view)
    setLoadFailed(v.view == null)
    setVariants(null)
    setStatus('result')
  }

  function voltarParaIdle() {
    setResult(null)
    setView(null)
    setErrorKey(null)
    setLoadFailed(false)
    setVariants(null)
    setStatus('idle')
  }

  // Foco no swap form↔resultado (a11y): quando o status muda, o heading do estado novo recebe o
  // foco para o teclado não cair no <body>.
  useEffect(() => {
    headingRef.current?.focus()
  }, [status])

  // #191 (ADR-0021): sinaliza ao shell (drawer) se há geração EM VOO, para travar o dismiss.
  useEffect(() => {
    onLoadingChange?.(status === 'loading')
  }, [status, onLoadingChange])

  return {
    status,
    result,
    view,
    errorKey,
    loadFailed,
    variants,
    headingRef,
    enviar,
    carregarReceita,
    escolherVariante,
    voltarParaIdle,
    setStatus,
    setErrorKey,
  }
}
