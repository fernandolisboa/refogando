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
 *
 * #457: "Receita da semana" (slot editorial da home) segue o MESMO admin-only por axis do Aviso —
 * `/api/admin/config`/`/api/admin/catalog/highlight-search` reforçam `requireRole 'admin'`.
 */
import { SectionGate, gateSection } from '../gate'
import { CatalogCuration } from '@/components/admin/catalog-curation'
import { CatalogRecipeQueue } from '@/components/admin/catalog-recipe-queue'
import { CatalogDisclosureConfigSection } from '@/components/admin/catalog-disclosure-config-section'
import { RecipeOfWeekConfigSection } from '@/components/admin/recipe-of-week-config-section'

export const runtime = 'nodejs'

export default async function AdminCatalogPage() {
  // Admin-only por axis: o Aviso fala com `/api/admin/config` (admin). Um Curador veria um form que
  // não carrega/salva (403) — então só renderiza pra admin. NÃO é gate de PÁGINA (o min é curador):
  // ignoramos os vereditos 'denied'/'redirect' aqui (a porta da página é o SectionGate min="curador").
  const isAdmin = typeof (await gateSection('admin')) === 'object'
  return (
    <SectionGate min="curador">
      <div className="flex flex-col gap-10">
        {/* #238/ADR-0026: fila de curadoria dos rascunhos de catálogo gerados por IA (o dono cura). */}
        <CatalogRecipeQueue />
        <CatalogCuration />
        {/* #457: escolha da "Receita da semana" (slot editorial da home, admin-only). */}
        {isAdmin && <RecipeOfWeekConfigSection />}
        {/* #237/#268: aviso de catálogo AI-assistido — liga/desliga + texto (admin-only). */}
        {isAdmin && <CatalogDisclosureConfigSection />}
      </div>
    </SectionGate>
  )
}
