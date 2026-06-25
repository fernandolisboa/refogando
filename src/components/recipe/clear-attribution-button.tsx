'use client'
/**
 * Botão LGPD (#272, ADR-0019) — o DONO de uma Receita IMPORTADA da web remove o NOME da fonte
 * (publisher/autor); a atribuição passa a mostrar só o site (o `source_url` fica). SELF-GATING: só
 * aparece quando há um nome HUMANO a remover (origin `web_imported` + `source.name` ≠ host), pela MESMA
 * regra do servidor (domínio puro `sourceNameIsHost`) — as duas pontas não podem divergir.
 *
 * Confirmação INLINE (ação intencional e baixo-risco — não precisa do modal de apagar). POST
 * /api/recipes/[id]/clear-attribution → 200 devolve a view; aqui só `router.refresh()` (o detalhe
 * re-renderiza a atribuição sem o nome e este botão some). Tokens NEUTROS (ADR-0004).
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { sourceNameIsHost } from '@/domain/source-host'
import { Button } from '@/components/ui/button'
import type { RecipeView } from '@/domain/recipe-read'

type State = 'idle' | 'confirming' | 'loading' | 'error'

export function ClearAttributionButton({ view }: { view: RecipeView }) {
  const { messages } = useLocale()
  const m = messages.detalhe
  const router = useRouter()
  const [state, setState] = useState<State>('idle')

  // Só p/ importada COM nome humano (≠ host). Espelha o gate do servidor: senão o botão seria um no-op.
  if (view.origin !== 'web_imported' || sourceNameIsHost(view.source?.name, view.source?.url)) {
    return null
  }

  async function remover() {
    setState('loading')
    try {
      const res = await fetch(`/api/recipes/${view.id}/clear-attribution`, { method: 'POST' })
      if (res.status === 200) {
        router.refresh() // a atribuição cai pro host; este botão some no re-render
        return
      }
      setState('error')
    } catch {
      setState('error')
    }
  }

  if (state === 'confirming' || state === 'loading') {
    const loading = state === 'loading'
    return (
      <div className="flex flex-col gap-2">
        <p className="max-w-[60ch] text-sm text-muted">{m.removerNomeFonteAjuda}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={remover} disabled={loading} aria-busy={loading}>
            {m.removerNomeFonteConfirma}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setState('idle')} disabled={loading}>
            {m.removerNomeFonteCancela}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="secondary" onClick={() => setState('confirming')}>
        {m.removerNomeFonte}
      </Button>
      {state === 'error' && (
        <p role="alert" className="text-sm font-medium text-fg">
          {m.removerNomeFonteErro}
        </p>
      )}
    </div>
  )
}
