/**
 * Redirect legado de RETOMADA (#104 S7) — `/conversation/[id]` deixou de ter rota própria. O
 * Modo Conversa vive dentro de `/create` agora; a retomada é dirigida pelo search param
 * `?resume=<id>` (lido por `CreatePageClient` → `ConversaFocusedView`). Esta rota antiga
 * redireciona para `/create?mode=conversa&resume=<id>`, preservando links/bookmarks de retomada
 * sem 404 (params é uma Promise no Next 15 — `await params`). `encodeURIComponent` no id para
 * não corromper a querystring com caracteres especiais.
 */
import { redirect } from 'next/navigation'

export default async function ConversationResumePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/create?mode=conversa&resume=${encodeURIComponent(id)}`)
}
