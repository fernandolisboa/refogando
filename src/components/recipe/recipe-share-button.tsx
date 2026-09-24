'use client'

/**
 * Botão compartilhar do detalhe (#453) — ícone no topo, ao lado do bookmark (mesmo padrão visual
 * de `RecipeEngagementControls`). Funciona para o Visitante ANÔNIMO também (CONTEXT.md:168,
 * "compartilha por texto") — NUNCA gateado por sessão/pool (ao contrário do bookmark, que exige a
 * Receita estar no pool OU ser gerida pelo dono). Renderiza incondicionalmente em `DetailChrome`.
 *
 * Web Share API (`navigator.share`) quando disponível: compartilha o texto "grupo de WhatsApp"
 * (título + ingredientes + passos + link, `buildRecipeShareText`) — o LINK vai embutido no fim do
 * texto, sem campo `url` separado (evita duplicar o link quando o alvo de compartilhamento
 * concatena os dois). Cancelamento do usuário (`AbortError`) é silencioso — não é erro.
 *
 * Fallback (sem Web Share, ex. desktop): copia SÓ O LINK pro clipboard (`navigator.clipboard`) e
 * mostra confirmação transiente "Link copiado!" — não o texto formatado inteiro (o Web Share é o
 * único caminho pro texto rico; o fallback é deliberadamente mais simples).
 *
 * #453 (achado de code-review): lê o `factor` corrente do `PortionScaleProvider` (mesmo contexto
 * que `RecipePortionScaler`/#452 escreve) e escala cada ingrediente (`scaleIngredient`) ANTES de
 * formatar — sem isto, compartilhar sempre mandaria a quantidade ORIGINAL, ignorando a porção
 * ajustada na tela (o caso de uso central: "escalei pra 8 porções, agora compartilho com o grupo").
 * Sem porções conhecidas, `factor` é 1 (no-op) — igual a antes.
 */
import { useEffect, useRef, useState } from 'react'
import { Check, Share2 } from 'lucide-react'
import { useLocale } from '@/i18n/provider'
import { formatIngredientLine, scaleIngredient } from '@/domain/ingredient-line'
import { buildRecipeShareText } from '@/domain/recipe-share-text'
import type { RecipeView } from '@/domain/recipe-read'
import { cn } from '@/lib/utils'
import { usePortionScale } from './recipe-portion-scale-context'

const ICON_BUTTON =
  'inline-flex size-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-brand/10 hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40'

/** Confirmação "Link copiado!" some sozinha depois de um tempo — cortesia visual, não requer ação. */
const COPIED_TIMEOUT_MS = 2000

export function RecipeShareButton({ view }: { view: RecipeView }) {
  const { messages: m, locale } = useLocale()
  const { factor } = usePortionScale()
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    }
  }, [])

  async function handleShare() {
    setError(false)
    const url = window.location.href
    const ingredientLines = [...view.ingredients]
      .sort((a, b) => a.ordem - b.ordem)
      .map((item) => formatIngredientLine(scaleIngredient(item, factor), m, locale))
      .filter((line) => line !== '')
    const text = buildRecipeShareText(
      { name: view.name, ingredientLines, steps: view.body.passos ?? [], url },
      m,
    )

    // Feature-detect por TIPO (não `'share' in navigator`): a Web Share API costuma estar
    // simplesmente AUSENTE (não uma propriedade própria com valor `undefined`) nos alvos sem
    // suporte, mas `typeof` é robusto nos dois casos e é a forma idiomática de checar.
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: view.name, text })
        return
      } catch (err) {
        // Cancelamento do usuário no seletor nativo: silencioso, não é erro. Qualquer outra
        // falha (ex. API presente mas indisponível no contexto) cai no fallback abaixo.
        if (err instanceof Error && err.name === 'AbortError') return
      }
    }

    if (typeof navigator.clipboard?.writeText !== 'function') {
      setError(true)
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), COPIED_TIMEOUT_MS)
    } catch {
      setError(true)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {/* `aria-label` fica SEMPRE em "Compartilhar" (a AÇÃO do botão, não um resultado passado
          transiente) — a confirmação "Link copiado!" é anunciada só pelo `role="status"` abaixo
          (achado de code-review: trocar o rótulo do botão pra descrever um estado efêmero perde a
          semântica da ação pra quem navega de volta via leitor de tela). */}
      <button
        type="button"
        onClick={() => void handleShare()}
        aria-label={m.detalhe.compartilhar}
        className={cn(ICON_BUTTON, copied && 'text-brand-ink')}
      >
        {copied ? (
          <Check className="size-5" strokeWidth={1.5} aria-hidden />
        ) : (
          <Share2 className="size-5" strokeWidth={1.5} aria-hidden />
        )}
      </button>
      {copied && (
        <p role="status" className="text-xs text-muted">
          {m.detalhe.linkCopiado}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-fg">
          {m.detalhe.compartilharErro}
        </p>
      )}
    </div>
  )
}
