/**
 * Seção Fila de moderação (#125, Curadoria) — curador+. Revalida o papel server-side com
 * `min='curador'`. Monta o componente EXISTENTE; a API `/api/curate/*` ainda reforça
 * `requireRole 'curador'`.
 */
import { SectionGate } from '../gate'
import { ModerationQueue } from '@/components/admin/moderation-queue'

export const runtime = 'nodejs'

export default async function AdminModerationPage() {
  return (
    <SectionGate min="curador">
      <ModerationQueue />
    </SectionGate>
  )
}
