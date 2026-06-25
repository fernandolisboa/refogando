/**
 * Seção Curadoria de catálogo (#125, Curadoria) — curador+. Revalida o papel server-side
 * com `min='curador'`. Monta o componente EXISTENTE; a API `/api/curate/*` ainda reforça
 * `requireRole 'curador'`.
 *
 * #268: o "Aviso do catálogo" (cortesia editorial AI-assistida, #237) passou a viver AQUI — perto
 * do Catálogo, onde conceitualmente pertence — mas continua ADMIN-ONLY: a API `/api/admin/config`
 * reforça `requireRole 'admin'`, então a seção só é renderizada quando o usuário é admin (gating
 * preservado — o Curador NÃO a vê). Detecção via `gateSection('admin')` (mesmo veredito fail-closed
 * do gate de rota): retorna `{ role }` só pra admin; 'denied'/'redirect' caso contrário.
 */
import { SectionGate, gateSection } from '../gate'
import { CatalogCuration } from '@/components/admin/catalog-curation'
import { CatalogDisclosureConfigSection } from '@/components/admin/catalog-disclosure-config-section'

export const runtime = 'nodejs'

export default async function AdminCatalogPage() {
  // Admin-only por axis: o Aviso fala com `/api/admin/config` (admin). Um Curador veria um form que
  // não carrega/salva (403) — então só renderiza pra admin. NÃO é gate de PÁGINA (o min é curador):
  // ignoramos os vereditos 'denied'/'redirect' aqui (a porta da página é o SectionGate min="curador").
  const isAdmin = typeof (await gateSection('admin')) === 'object'
  return (
    <SectionGate min="curador">
      <div className="flex flex-col gap-10">
        <CatalogCuration />
        {/* #237/#268: aviso de catálogo AI-assistido — liga/desliga + texto (admin-only). */}
        {isAdmin && <CatalogDisclosureConfigSection />}
      </div>
    </SectionGate>
  )
}
