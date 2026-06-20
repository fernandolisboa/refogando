/**
 * Seção Modelo padrão (#125, Governança) — admin-only. Revalida o papel server-side com
 * `min='admin'`: um Curador batendo direto aqui é barrado (`AccessDenied`), não só pelo link
 * escondido. Monta o componente de seção EXISTENTE (sem mudar seu comportamento). A API
 * `/api/admin/config` ainda reforça `requireRole 'admin'`.
 */
import { SectionGate } from '../gate'
import { ConfigSection } from '@/components/admin/config-section'

export const runtime = 'nodejs'

export default async function AdminConfigPage() {
  return (
    <SectionGate min="admin">
      <ConfigSection />
    </SectionGate>
  )
}
