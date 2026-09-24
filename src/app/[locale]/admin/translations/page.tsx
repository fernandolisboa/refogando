/**
 * Seção Traduções (#125, Curadoria) — curador+. Revalida o papel server-side com `min='curador'`.
 * Compõe DUAS listas (a API de cada uma ainda reforça `requireRole 'curador'`):
 *  - `StaleTranslations` (#63/#23): sinalização leve `stale=true`, some ao marcar revisada.
 *  - `DivergentStaleTranslations` (#500, ADR-0031 dec.6): defasadas-E-divergentes — a fonte
 *    mudou e o conteúdo já diverge da última MT (ou é legado sem `mt_fingerprint`), ou o
 *    tradutor falhou repetidamente na linha (quarentena do circuit-breaker, #520). Query
 *    própria (pull-derived por fingerprint), SEPARADA da fila `stale` acima — não conflita.
 */
import { SectionGate } from '../gate'
import { StaleTranslations } from '@/components/admin/stale-translations'
import { DivergentStaleTranslations } from '@/components/admin/divergent-stale-translations'
import { loggedInPageMetadata } from '@/server/http/page-metadata'

export const runtime = 'nodejs'

// #462: título fino ("Traduções") + noindex — casa o rótulo da aba do Console (curador+).
export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return loggedInPageMetadata(params, (m) => m.admin.navTraducoes)
}

export default async function AdminTranslationsPage() {
  return (
    <SectionGate min="curador">
      <div className="flex flex-col gap-8">
        <StaleTranslations />
        <DivergentStaleTranslations />
      </div>
    </SectionGate>
  )
}
