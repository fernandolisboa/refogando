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

export type Status = 'idle' | 'loading' | 'result' | 'error'

export type GenerationResult = {
  outcome: 'success' | 'degraded' | 'playful' | 'impossible'
  recipeId?: string | null
  advisory: string | null
  avisos?: AvisoView[]
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
    default:
      return m.erroCampos
  }
}

export type RecipeGenerationEngine = {
  status: Status
  result: GenerationResult | null
  view: RecipeView | null
  errorKey: string | null
  loadFailed: boolean
  headingRef: React.RefObject<HTMLHeadingElement | null>
  /** Posta o `body` em /api/generations e converge para result/error (sem montar o body aqui). */
  enviar: (body: unknown) => Promise<void>
  /** Re-busca o corpo de uma Receita JÁ criada (botão "tentar carregar de novo"). */
  carregarReceita: (generation: GenerationResult) => Promise<void>
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

  const headingRef = useRef<HTMLHeadingElement | null>(null)

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
      if (res.status === 429) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setErrorKey(data.error === 'limite_geracao' ? 'limite_geracao' : 'erroGeracao')
        setStatus('error')
        return
      }
      if (!res.ok) {
        // 502 (outcome:'invalid') e qualquer outro não-ok caem em erro de geração neutro.
        setErrorKey('erroGeracao')
        setStatus('error')
        return
      }

      const data = (await res.json()) as GenerationResult
      setResult(data)
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

  function voltarParaIdle() {
    setResult(null)
    setView(null)
    setErrorKey(null)
    setLoadFailed(false)
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
    headingRef,
    enviar,
    carregarReceita,
    voltarParaIdle,
    setStatus,
    setErrorKey,
  }
}
