/**
 * Seção Usuários (Pessoas) — admin-only. Revalida o papel server-side com `min='admin'`: Curador é barrado
 * (`AccessDenied`). Rota `/admin/users` (antes "Papéis"; a atribuição de papel agora mora na gaveta de detalhes
 * da lista). As APIs `/api/admin/users` e `/api/admin/roles` ainda reforçam `requireRole 'admin'`.
 */
import { SectionGate } from '../gate'
import { UsersSection } from '@/components/admin/users-section'
import { loggedInPageMetadata } from '@/server/http/page-metadata'

export const runtime = 'nodejs'

// #462: título fino ("Usuários") + noindex — casa o rótulo da aba do Console (admin-only).
export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return loggedInPageMetadata(params, (m) => m.admin.navUsuarios)
}

export default async function AdminUsersPage() {
  return (
    <SectionGate min="admin">
      <UsersSection />
    </SectionGate>
  )
}
