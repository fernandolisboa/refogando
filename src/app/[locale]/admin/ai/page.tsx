/**
 * Seção Geração de imagem por IA (#134, Governança) — admin-only. Revalida o papel server-side com
 * `min='admin'` (um Curador batendo direto aqui é barrado por `AccessDenied`, não só pelo link
 * escondido). A API `/api/admin/config` ainda reforça `requireRole 'admin'`. Espelha config/page.tsx.
 */
import { SectionGate } from '../gate'
import { AiConfigSection } from '@/components/admin/ai-config-section'
import { WebSearchConfigSection } from '@/components/admin/web-search-config-section'
import { CatalogDisclosureConfigSection } from '@/components/admin/catalog-disclosure-config-section'
import { EmbeddingBackfill } from '@/components/admin/embedding-backfill'

export const runtime = 'nodejs'

export default async function AdminAiPage() {
  return (
    <SectionGate min="admin">
      <div className="flex flex-col gap-10">
        <AiConfigSection />
        {/* #164: descoberta na web (ADR-0019) — liga/desliga + allowlist de domínios (admin-only). */}
        <WebSearchConfigSection />
        {/* #237: aviso de catálogo AI-assistido (SEO #187) — liga/desliga + texto editável (admin-only). */}
        <CatalogDisclosureConfigSection />
        {/* #119: backfill dos embeddings da busca semântica (recompute em lote, admin-only). */}
        <EmbeddingBackfill />
      </div>
    </SectionGate>
  )
}
