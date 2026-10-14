/**
 * Seção "Site" (#451, Governança) — ADMIN-only. Revalida o papel server-side com `min='admin'`
 * (o gate de rota é a barreira; a API `/api/admin/config` reforça `requireRole 'admin'`). Lar dos
 * links de redes sociais do rodapé — e futuras configs de chrome do site.
 */
import { SectionGate } from '../gate'
import { SocialLinksConfigSection } from '@/components/admin/social-links-config-section'
import { loggedInPageMetadata } from '@/server/http/page-metadata'

export const runtime = 'nodejs'

// #462: título fino ("Site") + noindex — casa o rótulo da aba do Console (admin-only).
export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return loggedInPageMetadata(params, (m) => m.admin.navSite)
}

export default function AdminSitePage() {
  return (
    <SectionGate min="admin">
      <div className="flex flex-col gap-10">
        <SocialLinksConfigSection />
      </div>
    </SectionGate>
  )
}
