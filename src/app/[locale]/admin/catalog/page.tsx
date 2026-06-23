/**
 * Seção Curadoria de catálogo (#125, Curadoria) — curador+. Revalida o papel server-side
 * com `min='curador'`. Monta o componente EXISTENTE; a API `/api/curate/*` ainda reforça
 * `requireRole 'curador'`.
 */
import { SectionGate } from '../gate'
import { CatalogCuration } from '@/components/admin/catalog-curation'

export const runtime = 'nodejs'

export default async function AdminCatalogPage() {
  return (
    <SectionGate min="curador">
      <CatalogCuration />
    </SectionGate>
  )
}
