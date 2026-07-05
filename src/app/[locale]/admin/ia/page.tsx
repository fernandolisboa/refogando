/**
 * Seção "IA" (#125/#268, Governança) — admin-only. Revalida o papel server-side com
 * `min='admin'`: um Curador batendo direto aqui é barrado (`AccessDenied`), não só pelo link
 * escondido. A API `/api/admin/config` ainda reforça `requireRole 'admin'`.
 *
 * Reúne TODA a IA generativa: o modelo de geração padrão (receita/texto, `ConfigSection`) e a
 * geração de imagem — modelo + tetos diários por papel (`AiConfigSection`). A infra de busca
 * (descoberta na web + embeddings) mora na aba "Descoberta" (descoberta/page.tsx). Rota `/admin/ia`
 * (renomeada de `/admin/config` no #336 p/ casar o label da aba).
 */
import { SectionGate } from '../gate'
import { ConfigSection } from '@/components/admin/config-section'
import { AiConfigSection } from '@/components/admin/ai-config-section'
import { AiCostSection } from '@/components/admin/ai-cost-section'

export const runtime = 'nodejs'

export default async function AdminConfigPage() {
  return (
    <SectionGate min="admin">
      <div className="flex flex-col gap-10">
        <ConfigSection />
        {/* #134/#167: geração de imagem — modelo + tetos diários por papel (admin-only). */}
        <AiConfigSection />
        {/* #465: custo de IA — agrega os ledgers de texto (#463) + imagem (#224), read-only. */}
        <AiCostSection />
      </div>
    </SectionGate>
  )
}
