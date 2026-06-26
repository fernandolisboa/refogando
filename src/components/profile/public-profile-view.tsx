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
import type { PublicProfile, ProfileFollowUser } from '@/domain/recipe-profile-read'
import type { Messages } from '@/i18n/messages'
import { RecipeResultItem } from '@/components/recipe/recipe-result-item'
import { Avatar } from '@/components/profile/avatar'
import { ProfileFollowSection } from '@/components/profile/profile-follow-section'

export function PublicProfileView({
  profile,
  m,
  locale,
}: {
  profile: PublicProfile
  m: Messages
  /** #231/ADR-0020: locale corrente (segmento `[locale]` da página), pro link canônico de cada card. */
  locale: string
}) {
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

  // Lista de seguir (#274): seção capada de Cozinheiros (avatar+nome+@handle linkando o perfil). Vazia
  // ⇒ OMITIDA (tela limpa); como contador e lista concordam (ambos gateiam soft-deleted), lista não-
  // vazia ⟺ contador > 0.
  const followList = (titleId: string, title: string, list: ProfileFollowUser[]) =>
    list.length === 0 ? null : (
      <section aria-labelledby={titleId} className="flex flex-col gap-2">
        <h2 id={titleId} className="font-display text-lg font-semibold tracking-tight text-fg">
          {title}
        </h2>
        <ul className="flex flex-col gap-1">
          {list.map((u) => (
            <li key={u.handle}>
              <Link
                href={`/u/${u.handle}`}
                className="flex items-center gap-3 rounded-md py-1 transition-colors hover:text-fg"
              >
                <Avatar src={u.image} name={u.name} alt="" size="sm" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-fg">{u.name}</span>
                  <span className="truncate text-xs text-muted">@{u.handle}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    )

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

      {/* Social (#274): a ilha detém AMBOS os contadores ADJACENTES — SEGUIDORES (muda no clique) e
          SEGUINDO (estático SSR, por prop) — seguidos do botão Seguir/Seguindo ao FINAL (anon →
          "Entrar para seguir"; próprio perfil → sem botão). O botão NUNCA fica entre os contadores.
          Tudo público, anon-cacheável (o "eu sigo?" é resolvido client-side dentro da ilha). */}
      <ProfileFollowSection
        handle={profile.handle}
        initialFollowerCount={profile.social.followerCount}
        followingCount={profile.social.followingCount}
        labels={mp}
      />

      {/* Receitas PÚBLICAS do dono. Vazio ⇒ mensagem; senão ⇒ LINHAS editoriais (mesmo item
          da Busca/Feed — protótipo RefoStage). Sem byline (a autoria é o próprio dono da página). */}
      <section aria-labelledby="perfil-receitas" className="flex flex-col gap-2">
        <h2 id="perfil-receitas" className="font-display text-lg font-semibold tracking-tight text-fg">
          {mp.receitasTitulo}
        </h2>
        {profile.recipes.length === 0 ? (
          <p className="text-muted">{mp.semReceitas}</p>
        ) : (
          <ul className="flex flex-col">
            {profile.recipes.map((r) => (
              <RecipeResultItem
                key={r.recipeId}
                recipeId={r.recipeId}
                locale={locale}
                slug={r.slug}
                displayedTitle={r.displayedTitle}
                origin={r.origin}
                autoTranslationSignal={false}
                badgeLabels={badgeLabels}
                autoTranslationLabel={mb.traducaoAutomatica}
                imageUrl={r.imageUrl}
                imageAiGenerated={r.imageAiGenerated}
                aiLabel={mb.imagemSeloIa}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Listas públicas (#274): Seguidores e Seguindo (preview capado; contador dá o total). */}
      {followList('perfil-seguidores', mp.seguidoresTitulo, profile.social.followers)}
      {followList('perfil-seguindo', mp.seguindoTitulo, profile.social.following)}
    </article>
  )
}
