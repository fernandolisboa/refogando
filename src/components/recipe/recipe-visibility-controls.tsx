'use client'

/**
 * Controles de Visibilidade (#59) — bloco de gestão do DONO: estado atual (privada/pública)
 * + toggle publicar/despublicar. Irmão do `RecipeDetailView` (que continua PURO, sem hooks):
 * a page de detalhe renderiza isto SÓ quando `view.canManage` (dono).
 *
 * ADR-0010: consome os ROUTE HANDLERS `POST /api/recipes/[id]/publish` e `.../unpublish`
 * via `fetch` (NÃO Server Action). O servidor é a verdade — impõe ownership e o invariante
 * playful; isto é AFORDÂNCIA: espelha 422/404 que a rota devolve, não reimplementa domínio.
 *
 * Cores: só tokens já AA-verificados na #54. ÂMBAR é PROIBIDO aqui (ADR-0004: âmbar é
 * EXCLUSIVO do Aviso de restrição) — estado, nota playful e erro usam tokens NEUTROS.
 * O badge de estado é subordinado ao `<h2>` + descrição (não se confunde com o selo de
 * proveniência Catálogo/Comunidade do header, que diferencia por accent).
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Origin, ResultKind, Visibility } from '@/domain/recipe'
import type { RecipeView } from '@/domain/recipe-read'
import { useLocale } from '@/i18n/provider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/** Chaves de erro tratadas no toggle — mapeadas para a mensagem localizada neutra. */
type ErrorKey =
  | 'playful_nao_publicavel'
  | 'web_imported_nao_publicavel'
  | 'not_found'
  | 'erroGenerico'

export function RecipeVisibilityControls({
  recipeId,
  initialVisibility,
  resultKind,
  origin,
}: {
  recipeId: string
  initialVisibility: Visibility
  resultKind: ResultKind
  origin: Origin
}) {
  const { messages } = useLocale()
  const m = messages.visibilidade
  const router = useRouter()

  const [visibility, setVisibility] = useState<Visibility>(initialVisibility)
  const [isLoading, setIsLoading] = useState(false)
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null)

  const isPublic = visibility === 'public'
  const isPlayful = resultKind === 'playful'
  // ADR-0019/#168: importada da web NUNCA pode publicar (republicar conteúdo de terceiros).
  const isWebImported = origin === 'web_imported'
  // Playful (ADR-0013) e importada (ADR-0019) nunca podem publicar; despublicar é sempre OK, mas
  // nenhuma das duas está pública, logo o botão só fica desabilitado no caminho de publicar.
  const publicarBloqueado = (isPlayful || isWebImported) && !isPublic

  async function handleToggle() {
    if (isLoading) return
    setIsLoading(true)
    setErrorKey(null)
    const endpoint = isPublic ? 'unpublish' : 'publish'
    try {
      const res = await fetch(`/api/recipes/${recipeId}/${endpoint}`, { method: 'POST' })
      if (res.status === 422) {
        // 422 cobre duas recusas: zoeira (ADR-0013) e importada da web (ADR-0019). Lê o
        // `error` p/ escolher a mensagem certa; default defensivo = playful.
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setErrorKey(
          body?.error === 'web_imported_nao_publicavel'
            ? 'web_imported_nao_publicavel'
            : 'playful_nao_publicavel',
        )
        return
      }
      if (res.status === 404) {
        setErrorKey('not_found')
        return
      }
      if (!res.ok) {
        setErrorKey('erroGenerico')
        return
      }
      const updated = (await res.json()) as RecipeView
      // A view do dono traz `visibility`; fallback defensivo p/ o alvo do toggle.
      setVisibility(updated.visibility ?? (isPublic ? 'private' : 'public'))
      // Relê a page server (status reflete em qualquer outra parte derivada da rota).
      router.refresh()
    } catch {
      setErrorKey('erroGenerico')
    } finally {
      setIsLoading(false)
    }
  }

  const erroMensagem =
    errorKey === 'playful_nao_publicavel'
      ? m.erroPlayful
      : errorKey === 'web_imported_nao_publicavel'
        ? m.erroWebImported
        : errorKey === 'not_found'
          ? m.erroNaoEncontrada
          : errorKey === 'erroGenerico'
            ? m.erroGenerico
            : null

  const botaoLabel = isLoading ? m.atualizando : isPublic ? m.despublicar : m.publicar
  // Despublicar é a ação menos destacada (secundária); publicar é o CTA primário.
  const botaoVariant = isPublic ? 'secondary' : 'default'

  return (
    <section
      aria-labelledby="visibilidade-titulo"
      className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3"
    >
      <div className="flex flex-col gap-1">
        <h2 id="visibilidade-titulo" className="font-display text-lg font-semibold text-fg">
          {m.titulo}
        </h2>
        <p className="font-medium text-fg">{isPublic ? m.publicaBadge : m.privadaBadge}</p>
        <p className="max-w-[60ch] text-sm text-muted">
          {isPublic ? m.publicaDescricao : m.privadaDescricao}
        </p>
      </div>

      {publicarBloqueado && (
        <p
          id="visibilidade-bloqueio-nota"
          className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg"
        >
          {/* web_imported tem precedência sobre playful (espelha a regra de domínio). */}
          {isWebImported ? m.webImportedBloqueio : m.playfulBloqueio}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant={botaoVariant}
          onClick={handleToggle}
          disabled={isLoading || publicarBloqueado}
          aria-busy={isLoading}
          aria-describedby={publicarBloqueado ? 'visibilidade-bloqueio-nota' : undefined}
          className="disabled:opacity-70"
        >
          {botaoLabel}
        </Button>
      </div>

      {erroMensagem && (
        <Alert variant="info" role="alert">
          <AlertDescription className="font-medium text-foreground">
            {erroMensagem}
          </AlertDescription>
        </Alert>
      )}
    </section>
  )
}
