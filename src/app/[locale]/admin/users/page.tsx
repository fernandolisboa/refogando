/**
 * Seção Papéis de usuário (#125, Governança) — admin-only. Revalida o papel server-side com
 * `min='admin'`: Curador é barrado (`AccessDenied`). Rota `/admin/users` (papéis = "users").
 * Monta o componente EXISTENTE; a API `/api/admin/roles` ainda reforça `requireRole 'admin'`.
 */
import { SectionGate } from '../gate'
import { RolesSection } from '@/components/admin/roles-section'
import { loggedInPageMetadata } from '@/server/http/page-metadata'

export const runtime = 'nodejs'

// #462: título fino ("Papéis") + noindex — casa o rótulo da aba do Console (admin-only).
export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return loggedInPageMetadata(params, (m) => m.admin.navPapeis)
}

export default async function AdminUsersPage() {
  return (
    <SectionGate min="admin">
      <RolesSection />
    </SectionGate>
  )
}
