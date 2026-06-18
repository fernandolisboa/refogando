'use client'

/**
 * Console de administração (#63) — layout + composição das seções. Recebe o `role` JÁ
 * garantido por prop do `page.tsx` (que resolveu a sessão server-side via
 * `decideAdminAccess`). Renderiza só o que o papel acessa: Config e Papéis SOMEM para o
 * Curador (AC5 — escondido, não desabilitado); Moderação/Stale/Curadoria são Curador+.
 *
 * Cada seção é Client Component que faz seu próprio `fetch` (ADR-0010) e reforça o gate
 * server-side na rota — esta árvore é só afordância. Rende seu próprio `<Container as="main">`
 * (um único landmark <main> por documento). Cores: só tokens AA-verificados da #54.
 */
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'
import { ConfigSection } from '@/components/admin/config-section'
import { RolesSection } from '@/components/admin/roles-section'
import { ModerationQueue } from '@/components/admin/moderation-queue'
import { StaleTranslations } from '@/components/admin/stale-translations'
import { CatalogCuration } from '@/components/admin/catalog-curation'

export function AdminConsole({ role }: { role: 'admin' | 'curador' }) {
  const { messages } = useLocale()
  const m = messages.admin
  const isAdmin = role === 'admin'

  return (
    <Container as="main" className="flex flex-1 flex-col gap-12 py-8 sm:py-12">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold text-fg">{m.titulo}</h1>
        <p className="text-muted">{m.subtitulo}</p>
      </header>

      {/* Dois domínios distintos, agrupados para o Admin (que vê os dois) perceber a fronteira
          de "governança da Plataforma" → "Curadoria de conteúdo": cada grupo tem um rótulo
          discreto e respiro maior ENTRE grupos (gap-12) que DENTRO (gap-8). AC5: o grupo
          Plataforma (Config+Papéis) é Admin-only — ESCONDIDO para Curador (não desabilitado),
          então o wrapper inteiro só monta para isAdmin. */}
      {isAdmin && (
        <section aria-labelledby="grupo-plataforma" className="flex flex-col gap-8">
          {/* Rótulo de GRUPO como <p> (não heading): não polui a árvore de headings
              (h1 → h2 das seções); ainda nomeia a região via aria-labelledby para AT. */}
          <p
            id="grupo-plataforma"
            className="text-xs font-semibold uppercase tracking-wide text-muted"
          >
            {m.grupoPlataforma}
          </p>
          <ConfigSection />
          <RolesSection />
        </section>
      )}

      <section
        aria-labelledby="grupo-curadoria"
        className={`flex flex-col gap-8 ${isAdmin ? 'border-t border-border pt-12' : ''}`}
      >
        <p
          id="grupo-curadoria"
          className="text-xs font-semibold uppercase tracking-wide text-muted"
        >
          {m.grupoCuradoria}
        </p>
        <ModerationQueue />
        <StaleTranslations />
        <CatalogCuration />
      </section>
    </Container>
  )
}
