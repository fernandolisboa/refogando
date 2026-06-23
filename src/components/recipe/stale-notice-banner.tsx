/**
 * Nota leve de tradução obsoleta + link "ver o original" (#23/#57) — componente PURO.
 * Recebe `notice: StaleNotice` (mensagem + rótulo JÁ renderizados no locale pela rota) +
 * `recipeId` por prop SEPARADA: o tipo `StaleNotice` NÃO carrega `id` (vem de `view.id`).
 *
 * Locale-no-caminho (ADR-0020, #228/#231): o href fica PREFIXADO no locale CORRENTE (`notice.locale`
 * = o requestLocale/chrome em que esta nota foi renderizada) via o helper canônico `recipeDetailPath`,
 * e usa `?original=<originalLocale>` pra LER o corpo no idioma-fonte SEM trocar a chrome/o path. O
 * path é a verdade da chrome, então o segmento `[locale]` segue o corrente e o conteúdo é trocado pelo
 * escape explícito `?original` (o `?locale` legado morreu com o path-wins). Manter o prefixo evita o
 * bounce do proxy (302) e vai direto ao canônico.
 *
 * #231: o segmento é o `slug` do locale corrente quando o caller o conhece; AUSENTE (a `RecipeView`
 * não carrega slug hoje) ⇒ cai no fallback canônico por UUID `/{locale}/recipes/<uuid>` (que 308a pro
 * slug) — locale-prefixado, NUNCA link nu. Token NEUTRO (não âmbar): stale é informativo. `role="note"`.
 */
import Link from 'next/link'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { recipeDetailPath } from '@/domain/recipe-detail-route'
import type { StaleNotice } from '@/domain/recipe-read'

export function StaleNoticeBanner({
  notice,
  recipeId,
  slug,
}: {
  notice: StaleNotice
  recipeId: string
  /**
   * Slug do locale corrente (#231) — quando presente, o link aponta o canônico `/{locale}/recipes/
   * <slug>`. AUSENTE ⇒ fallback por UUID (que 308a). A `RecipeView` não carrega slug hoje, então o
   * caller atual não o passa (fallback) — a prop deixa o caminho pronto p/ quando o slug for threado.
   */
  slug?: string
}) {
  const href = `${recipeDetailPath(notice.locale, slug ?? recipeId)}?original=${encodeURIComponent(notice.originalLocale)}`
  return (
    <Alert variant="info" role="note" className="flex flex-col items-start gap-2">
      <AlertDescription className="text-muted-foreground">{notice.mensagem}</AlertDescription>
      <Button asChild variant="secondary">
        <Link href={href}>{notice.verOriginalLabel}</Link>
      </Button>
    </Alert>
  )
}
