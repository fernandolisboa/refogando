/**
 * Perfil PÚBLICO (#129) — componente PURO da página `/u/<handle>`. SEM hooks de fetch/locale:
 * recebe `profile: PublicProfile` (a rota JÁ resolveu nome/títulos no locale pedido — ADR-0010)
 * + `m: Messages` (rótulos já localizados). É o nó testável isolado no jsdom.
 *
 * Renderiza: avatar (de `users.image`, com fallback de iniciais quando NULL — #126/Vercel-Blob
 * não é dependência), nome, @handle, bio, links sociais CLICÁVEIS e seguros, e as Receitas
 * PÚBLICAS do dono (cards com byline de Autoria linkando de volta ao próprio perfil). "Tela
 * limpa": bio/links/recipes ausentes ⇒ blocos OMITIDOS (sem chrome vazio).
 *
 * SEGURANÇA dos links: o `href` é re-guardado por `safeHttpUrl` (#127, defesa-em-profundidade)
 * ANTES de emitir; `rel="noopener noreferrer"` + `target="_blank"` em todo link externo.
 */
import Link from 'next/link'
import { safeHttpUrl } from '@/domain/links'
import { classifySection } from '@/domain/recipe'
import type { PublicProfile } from '@/domain/recipe-profile-read'
import type { Messages } from '@/i18n/messages'
import { ProvenanceBadge } from '@/components/recipe/provenance-badge'

/** Iniciais para o avatar de fallback (NULL `image`): 1ª letra das 2 primeiras palavras do nome. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => p.length > 0)
  if (parts.length === 0) return '?'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase()
}

export function PublicProfileView({ profile, m }: { profile: PublicProfile; m: Messages }) {
  const mp = m.perfilPublico
  const mb = m.busca
  // Rótulos de selo de proveniência por seção (reusa busca.*, mesmo conceito do feed/busca).
  const badgeLabels = { catalogo: mb.seloCatalogo, comunidade: mb.seloComunidade }
  // Links seguros (defesa-em-profundidade #127): só http(s) emite href clicável.
  const safeLinks = profile.links
    .map((l) => ({ tipo: l.tipo, url: safeHttpUrl(l.url) }))
    .filter((l): l is { tipo: typeof l.tipo; url: string } => l.url !== null)
  const linkTipoLabel: Record<string, string> = {
    instagram: m.perfil.linkTipoInstagram,
    x: m.perfil.linkTipoX,
    github: m.perfil.linkTipoGithub,
    youtube: m.perfil.linkTipoYoutube,
    site: m.perfil.linkTipoSite,
  }

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        {/* Avatar: <img> simples de users.image (URL do Google OAuth ou NULL). NULL ⇒ iniciais.
            Não depende de next/image nem de Vercel-Blob (#126). */}
        {profile.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.image}
            alt={mp.avatarAlt.replace('{name}', profile.name)}
            referrerPolicy="no-referrer"
            className="h-20 w-20 shrink-0 rounded-full border border-border object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-border bg-surface font-display text-2xl text-muted"
          >
            {initials(profile.name)}
          </span>
        )}
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
            {profile.name}
          </h1>
          <p className="text-muted">@{profile.handle}</p>
        </div>
      </header>

      {/* Bio — só quando presente (tela limpa). Medida confortável de leitura. */}
      {profile.bio && <p className="max-w-[68ch] text-pretty text-fg">{profile.bio}</p>}

      {/* Links sociais — só quando há ≥ 1 seguro. Clicáveis com rel/target endurecidos. */}
      {safeLinks.length > 0 && (
        <nav aria-label={mp.linksLabel} className="flex flex-wrap gap-3">
          {safeLinks.map((l) => (
            <a
              key={`${l.tipo}-${l.url}`}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted underline hover:text-fg"
            >
              {linkTipoLabel[l.tipo] ?? l.tipo}
            </a>
          ))}
        </nav>
      )}

      {/* Receitas PÚBLICAS do dono. Vazio ⇒ mensagem; senão ⇒ grade de cards com byline. */}
      <section aria-labelledby="perfil-receitas" className="flex flex-col gap-3">
        <h2 id="perfil-receitas" className="font-display text-xl text-fg">
          {mp.receitasTitulo}
        </h2>
        {profile.recipes.length === 0 ? (
          <p className="text-muted">{mp.semReceitas}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {profile.recipes.map((r) => {
              const section = classifySection(r.origin)
              return (
                <li
                  key={r.recipeId}
                  className="flex h-full flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-sm transition-shadow duration-150 ease-out hover:shadow-md"
                >
                  <Link
                    href={`/recipes/${r.recipeId}`}
                    className="flex flex-col gap-2 rounded-sm focus-visible:outline-none"
                  >
                    <ProvenanceBadge variant={section} label={badgeLabels[section]} />
                    <h3 className="font-display text-lg text-fg">{r.displayedTitle}</h3>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </article>
  )
}
