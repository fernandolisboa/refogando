/**
 * Nota leve de tradução obsoleta + link "ver o original" (#23/#57) — componente PURO.
 * Recebe `notice: StaleNotice` (mensagem + rótulo JÁ renderizados no locale pela rota) +
 * `recipeId` por prop SEPARADA: o tipo `StaleNotice` NÃO carrega `id` (vem de `view.id`).
 *
 * O href aponta pra origem (`?locale=originalLocale`); a página HONRA esse `?locale`
 * (precedência da URL em `resolvePageLocale`), fechando a jornada "ver o original" sem
 * trocar o cookie/idioma da chrome. Token NEUTRO (não âmbar): stale é informativo, não um
 * alerta de segurança — NÃO bloqueia a leitura. `role="note"`.
 */
import Link from 'next/link'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { StaleNotice } from '@/domain/recipe-read'

export function StaleNoticeBanner({
  notice,
  recipeId,
}: {
  notice: StaleNotice
  recipeId: string
}) {
  return (
    <Alert variant="info" role="note" className="flex flex-col items-start gap-2">
      <AlertDescription className="text-muted">{notice.mensagem}</AlertDescription>
      <Button asChild variant="secondary">
        <Link
          href={`/recipes/${recipeId}?locale=${encodeURIComponent(notice.originalLocale)}`}
        >
          {notice.verOriginalLabel}
        </Link>
      </Button>
    </Alert>
  )
}
