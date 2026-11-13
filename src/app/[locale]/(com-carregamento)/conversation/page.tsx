/**
 * Redirect legado (#104 S7) — o Modo Conversa deixou de ter rota própria: agora vive dentro da
 * tela CRIAR unificada (`/create`) atrás do toggle Formulário ↔ Conversa. Esta rota antiga
 * (`/conversation`, conversa NOVA) redireciona para `/create?mode=conversa`, que semeia o Modo
 * Conversa no primeiro render. Mantém vivos os links/bookmarks antigos sem 404.
 */
import { redirect } from 'next/navigation'
import { canonicalLocale, DEFAULT_LOCALE } from '@/i18n/locale'

// ADR-0061: o destino leva o locale da URL (sem ele, o 302 do proxy escolhia o idioma pelo cookie).
export default async function ConversationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect(`/${canonicalLocale(locale) ?? DEFAULT_LOCALE}/create?mode=conversa`)
}
