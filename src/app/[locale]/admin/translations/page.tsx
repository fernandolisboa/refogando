/**
 * Seção Traduções desatualizadas (#125, Curadoria) — curador+. Revalida o papel server-side
 * com `min='curador'`. Monta o componente EXISTENTE; a API `/api/curate/translations/*`
 * ainda reforça `requireRole 'curador'`.
 */
import { SectionGate } from '../gate'
import { StaleTranslations } from '@/components/admin/stale-translations'

export const runtime = 'nodejs'

export default async function AdminTranslationsPage() {
  return (
    <SectionGate min="curador">
      <StaleTranslations />
    </SectionGate>
  )
}
