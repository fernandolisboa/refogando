/**
 * Redirect legado de RETOMADA (#104 S7) — `/conversation/[id]` deixou de ter rota própria. O
 * Modo Conversa vive dentro de `/create` agora; a retomada é dirigida pelo search param
 * `?resume=<id>` (lido pelo shell de `/create` — `CreateShellClient` → `CreateDrawer`, #191/
 * ADR-0021, que roteia pro caminho Conversa). Esta rota antiga redireciona para
 * `/create?mode=conversa&resume=<id>`, preservando links/bookmarks de retomada sem 404 (params é
 * uma Promise no Next 15 — `await params`). `encodeURIComponent` no id para não corromper a
 * querystring com caracteres especiais.
 */
import { redirect } from 'next/navigation'

export default async function ConversationResumePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  // Locale-no-caminho (ADR-0020): preserva o prefixo de locale no destino, evitando um 2º hop
  // pelo proxy. A migração ampla de hrefs internos é #231; aqui é só o destino deste redirect.
  redirect(`/${locale}/create?mode=conversa&resume=${encodeURIComponent(id)}`)
}
