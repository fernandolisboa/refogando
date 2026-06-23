/**
 * Nota leve de tradução obsoleta + link "ver o original" (#23/#57) — componente PURO.
 * Recebe `notice: StaleNotice` (mensagem + rótulo JÁ renderizados no locale pela rota) +
 * `recipeId` por prop SEPARADA: o tipo `StaleNotice` NÃO carrega `id` (vem de `view.id`).
 *
 * Locale-no-caminho (ADR-0020, #228): o href fica PREFIXADO no locale CORRENTE (`notice.locale`
 * = o requestLocale/chrome em que esta nota foi renderizada) e usa `?original=<originalLocale>`
 * pra LER o corpo no idioma-fonte SEM trocar a chrome/o path. O path é a verdade da chrome, então
 * o segmento `[locale]` segue o corrente e o conteúdo é trocado pelo escape explícito `?original`
 * (o `?locale` legado morreu com o path-wins). Manter o prefixo evita o bounce do proxy (302) e
 * vai direto ao canônico. Token NEUTRO (não âmbar): stale é informativo, não bloqueia. `role="note"`.
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
      <AlertDescription className="text-muted-foreground">{notice.mensagem}</AlertDescription>
      <Button asChild variant="secondary">
        <Link
          href={`/${notice.locale}/recipes/${recipeId}?original=${encodeURIComponent(notice.originalLocale)}`}
        >
          {notice.verOriginalLabel}
        </Link>
      </Button>
    </Alert>
  )
}
