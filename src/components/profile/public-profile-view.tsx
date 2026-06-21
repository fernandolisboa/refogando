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
import { Avatar } from '@/components/profile/avatar'

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
  // "valor" do link (protótipo "Tipo · valor"): URL sem protocolo/www/barra final.
  const linkDisplay = (url: string) =>
    url
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/+$/, '')

  return (
    <article className="flex flex-col gap-8">
      {/* Voltar (protótipo): primeiro elemento, muted; href estável "/". */}
      <Link href="/" className="text-sm text-muted transition-colors hover:text-fg">
        ← {mp.voltar}
      </Link>

      {/* Header (protótipo): avatar + coluna com nome, @handle, bio e links juntos. */}
      <header className="flex flex-col items-start gap-5 sm:flex-row">
        {/* Avatar reutilizável (#126): users.image (Vercel Blob ou Google OAuth); NULL ⇒ iniciais. */}
        <Avatar
          src={profile.image}
          name={profile.name}
          alt={mp.avatarAlt.replace('{name}', profile.name)}
          size="lg"
        />
        <div className="flex flex-1 flex-col gap-2">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">
            {profile.name}
          </h1>
          <p className="text-muted">@{profile.handle}</p>
          {/* Bio — só quando presente (tela limpa). Medida ~52ch (protótipo). */}
          {profile.bio && <p className="max-w-[52ch] text-pretty text-fg">{profile.bio}</p>}
          {/* Links sociais "Tipo · valor" em tinta de marca (protótipo), sem sublinhado.
              Só quando há ≥ 1 seguro; rel/target endurecidos. */}
          {safeLinks.length > 0 && (
            <nav aria-label={mp.linksLabel} className="mt-1 flex flex-wrap gap-4">
              {safeLinks.map((l) => (
                <a
                  key={`${l.tipo}-${l.url}`}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-brand-ink hover:underline"
                >
                  {linkTipoLabel[l.tipo] ?? l.tipo} · {linkDisplay(l.url)}
                </a>
              ))}
            </nav>
          )}
        </div>
      </header>

      {/* Receitas PÚBLICAS do dono. Vazio ⇒ mensagem; senão ⇒ grade de cards. */}
      <section aria-labelledby="perfil-receitas" className="flex flex-col gap-4">
        <h2 id="perfil-receitas" className="font-display text-xl font-semibold text-fg">
          {mp.receitasTitulo}
        </h2>
        {profile.recipes.length === 0 ? (
          <p className="text-muted">{mp.semReceitas}</p>
        ) : (
          <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
            {profile.recipes.map((r) => {
              const section = classifySection(r.origin)
              return (
                <li
                  key={r.recipeId}
                  className="flex h-full flex-col gap-1.5 rounded-lg border border-border bg-surface p-4 shadow-sm transition-shadow duration-150 ease-out hover:shadow-md"
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
