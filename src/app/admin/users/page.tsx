/**
 * Seção Papéis de usuário (#125, Governança) — admin-only. Revalida o papel server-side com
 * `min='admin'`: Curador é barrado (`AccessDenied`). Rota `/admin/users` (papéis = "users").
 * Monta o componente EXISTENTE; a API `/api/admin/roles` ainda reforça `requireRole 'admin'`.
 */
import { SectionGate } from '../gate'
import { RolesSection } from '@/components/admin/roles-section'

export const runtime = 'nodejs'

export default async function AdminUsersPage() {
  return (
    <SectionGate min="admin">
      <RolesSection />
    </SectionGate>
  )
}
