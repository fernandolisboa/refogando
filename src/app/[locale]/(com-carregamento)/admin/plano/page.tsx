/**
 * Seção "Plano" (Fase 2 de billing, #466) — admin-only. Revalida o papel server-side com
 * `min='admin'`: um Curador batendo direto aqui é barrado (`AccessDenied`), não só pelo link
 * escondido. As APIs `/api/admin/config` (proCaps) e `/api/admin/user-plan` reforçam
 * `requireRole 'admin'`.
 *
 * Duas partes: (1) `PlanConfigSection` edita a tabela `pro` dos tetos (proCaps) das três dimensões
 * por papel; (2) `UserPlanSection` concede/reverte o plano de um usuário por @handle/email
 * (concierge manual). NADA aqui liga cobrança — o billing real ainda não está ligado.
 */
import { SectionGate } from '../gate'
import { PlanConfigSection } from '@/components/admin/plan-config-section'
import { UserPlanSection } from '@/components/admin/user-plan-section'
import { loggedInPageMetadata } from '@/server/http/page-metadata'

export const runtime = 'nodejs'

// Título fino ("Plano") + noindex — casa o rótulo da aba do Console (admin-only).
export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return loggedInPageMetadata(params, (m) => m.admin.navPlano)
}

export default async function AdminPlanoPage() {
  return (
    <SectionGate min="admin">
      <div className="flex flex-col gap-10">
        <PlanConfigSection />
        <UserPlanSection />
      </div>
    </SectionGate>
  )
}
