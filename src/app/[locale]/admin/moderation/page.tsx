/**
 * Seção Fila de moderação (#125, Curadoria) — curador+. Revalida o papel server-side com
 * `min='curador'`. Monta os componentes de fila; a API `/api/curate/*` ainda reforça
 * `requireRole 'curador'`. Duas filas independentes:
 *  - `ModerationQueue` (#63): fila REATIVA (reports de usuários).
 *  - `ReviewQueue` (#227): fila PROATIVA e NÃO-BLOQUEANTE (gerações por IA com refino do autor).
 */
import { SectionGate } from '../gate'
import { ModerationQueue } from '@/components/admin/moderation-queue'
import { ReviewQueue } from '@/components/admin/review-queue'

export const runtime = 'nodejs'

export default async function AdminModerationPage() {
  return (
    <SectionGate min="curador">
      <div className="flex flex-col gap-8">
        <ModerationQueue />
        <ReviewQueue />
      </div>
    </SectionGate>
  )
}
