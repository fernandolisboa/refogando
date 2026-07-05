/**
 * Seção Traduções desatualizadas (#125, Curadoria) — curador+. Revalida o papel server-side
 * com `min='curador'`. Monta o componente EXISTENTE; a API `/api/curate/translations/*`
 * ainda reforça `requireRole 'curador'`.
 */
import { SectionGate } from '../gate'
import { StaleTranslations } from '@/components/admin/stale-translations'
import { loggedInPageMetadata } from '@/server/http/page-metadata'

export const runtime = 'nodejs'

// #462: título fino ("Traduções") + noindex — casa o rótulo da aba do Console (curador+).
export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return loggedInPageMetadata(params, (m) => m.admin.navTraducoes)
}

export default async function AdminTranslationsPage() {
  return (
    <SectionGate min="curador">
      <StaleTranslations />
    </SectionGate>
  )
}
