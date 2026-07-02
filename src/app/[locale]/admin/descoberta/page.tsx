/**
 * Seção "Descoberta" (#268, Governança) — admin-only. Revalida o papel server-side com
 * `min='admin'` (um Curador batendo direto aqui é barrado por `AccessDenied`, não só pelo link
 * escondido). A API `/api/admin/config` ainda reforça `requireRole 'admin'`. Espelha ia/page.tsx.
 *
 * Reúne a infra de BUSCA/descoberta: descoberta na web (allowlist de domínios) e os embeddings
 * da busca semântica. A config de IA generativa (modelo de receita + geração de imagem + tetos)
 * mora na aba "IA" (ia/page.tsx). Rota `/admin/descoberta` (renomeada de `/admin/ai` no #336).
 */
import { SectionGate } from '../gate'
import { WebSearchConfigSection } from '@/components/admin/web-search-config-section'
import { EmbeddingBackfill } from '@/components/admin/embedding-backfill'
import { OperatorAttributionSection } from '@/components/admin/operator-attribution-section'

export const runtime = 'nodejs'

export default async function AdminAiPage() {
  return (
    <SectionGate min="admin">
      <div className="flex flex-col gap-10">
        {/* #164: descoberta na web (ADR-0019) — liga/desliga + allowlist de domínios (admin-only). */}
        <WebSearchConfigSection />
        {/* #119: backfill dos embeddings da busca semântica (recompute em lote, admin-only). */}
        <EmbeddingBackfill />
        {/* #396/GAP-4: atendimento ao autor externo (titular B) — remover atribuição (nome) em lote. */}
        <OperatorAttributionSection />
      </div>
    </SectionGate>
  )
}
