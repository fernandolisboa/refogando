/**
 * Redirect legado (#104 S7) — o Modo Conversa deixou de ter rota própria: agora vive dentro da
 * tela CRIAR unificada (`/create`) atrás do toggle Formulário ↔ Conversa. Esta rota antiga
 * (`/conversation`, conversa NOVA) redireciona para `/create?mode=conversa`, que semeia o Modo
 * Conversa no primeiro render. Mantém vivos os links/bookmarks antigos sem 404.
 */
import { redirect } from 'next/navigation'

export default function ConversationPage() {
  redirect('/create?mode=conversa')
}
