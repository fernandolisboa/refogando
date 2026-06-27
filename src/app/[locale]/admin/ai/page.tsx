/**
 * Seção "Descoberta" (#268, Governança) — admin-only. Revalida o papel server-side com
 * `min='admin'` (um Curador batendo direto aqui é barrado por `AccessDenied`, não só pelo link
 * escondido). A API `/api/admin/config` ainda reforça `requireRole 'admin'`. Espelha config/page.tsx.
 *
 * Reúne a infra de BUSCA/descoberta: descoberta na web (allowlist de domínios) e os embeddings
 * da busca semântica. A config de IA generativa (modelo de receita + geração de imagem + tetos)
 * mora na aba "IA" (config/page.tsx). A rota segue `/admin/ai` (rename cosmético das URLs no #336).
 */
import { SectionGate } from '../gate'
import { WebSearchConfigSection } from '@/components/admin/web-search-config-section'
import { EmbeddingBackfill } from '@/components/admin/embedding-backfill'

export const runtime = 'nodejs'

export default async function AdminAiPage() {
  return (
    <SectionGate min="admin">
      <div className="flex flex-col gap-10">
        {/* #164: descoberta na web (ADR-0019) — liga/desliga + allowlist de domínios (admin-only). */}
        <WebSearchConfigSection />
        {/* #119: backfill dos embeddings da busca semântica (recompute em lote, admin-only). */}
        <EmbeddingBackfill />
      </div>
    </SectionGate>
  )
}
