/**
 * Seção "Site" (#451, Governança) — ADMIN-only. Revalida o papel server-side com `min='admin'`
 * (o gate de rota é a barreira; a API `/api/admin/config` reforça `requireRole 'admin'`). Lar dos
 * links de redes sociais do rodapé — e futuras configs de chrome do site.
 */
import { SectionGate } from '../gate'
import { SocialLinksConfigSection } from '@/components/admin/social-links-config-section'

export const runtime = 'nodejs'

export default function AdminSitePage() {
  return (
    <SectionGate min="admin">
      <div className="flex flex-col gap-10">
        <SocialLinksConfigSection />
      </div>
    </SectionGate>
  )
}
