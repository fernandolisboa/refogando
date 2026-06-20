/**
 * Seção Geração de imagem por IA (#134, Governança) — admin-only. Revalida o papel server-side com
 * `min='admin'` (um Curador batendo direto aqui é barrado por `AccessDenied`, não só pelo link
 * escondido). A API `/api/admin/config` ainda reforça `requireRole 'admin'`. Espelha config/page.tsx.
 */
import { SectionGate } from '../gate'
import { AiConfigSection } from '@/components/admin/ai-config-section'

export const runtime = 'nodejs'

export default async function AdminAiPage() {
  return (
    <SectionGate min="admin">
      <AiConfigSection />
    </SectionGate>
  )
}
