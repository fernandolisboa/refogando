/**
 * Seção Taxonomia de cozinhas (#321, Governança) — admin-only. Revalida o papel server-side com
 * `min='admin'`: um Curador batendo direto aqui é barrado (`AccessDenied`), não só pelo link
 * escondido. Monta o componente de seção (`VocabularySection`); a API `/api/admin/vocabulary`
 * ainda reforça `requireRole 'admin'`.
 */
import { SectionGate } from '../gate'
import { VocabularySection } from '@/components/admin/vocabulary-section'
import { loggedInPageMetadata } from '@/server/http/page-metadata'

export const runtime = 'nodejs'

// #462: título fino ("Cozinhas") + noindex — casa o rótulo da aba do Console (admin-only).
export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return loggedInPageMetadata(params, (m) => m.admin.navVocabulario)
}

export default async function AdminVocabularyPage() {
  return (
    <SectionGate min="admin">
      <VocabularySection />
    </SectionGate>
  )
}
