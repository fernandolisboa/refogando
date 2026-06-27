/**
 * Seção Taxonomia de cozinhas (#321, Governança) — admin-only. Revalida o papel server-side com
 * `min='admin'`: um Curador batendo direto aqui é barrado (`AccessDenied`), não só pelo link
 * escondido. Monta o componente de seção (`VocabularySection`); a API `/api/admin/vocabulary`
 * ainda reforça `requireRole 'admin'`.
 */
import { SectionGate } from '../gate'
import { VocabularySection } from '@/components/admin/vocabulary-section'

export const runtime = 'nodejs'

export default async function AdminVocabularyPage() {
  return (
    <SectionGate min="admin">
      <VocabularySection />
    </SectionGate>
  )
}
