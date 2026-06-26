import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

// next/link precisa do AppRouterContext em runtime; no jsdom mockamos pra um <a> simples.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

// #274: o view agora monta a ilha `ProfileFollowSection` (usa `useSession`). Default ANÔNIMO —
// a ilha mostra o contador + o nudge "Entrar para seguir", sem tocar a API.
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: null, error: null, isPending: false, isRefetching: false, refetch: vi.fn() }),
}))

import { ptBR } from '@/i18n/messages/pt-BR'
import type { PublicProfile } from '@/domain/recipe-profile-read'
import { PublicProfileView } from '@/components/profile/public-profile-view'

/**
 * Teste de COMPONENTE jsdom do perfil PÚBLICO (#129) — seam de frontend (#54, sem browser/
 * Postgres). O nó testado é o PURO `PublicProfileView` (a página depende de fetch/headers
 * server). Fixtures no shape REAL `PublicProfile`.
 */

const M = ptBR

function baseProfile(over: Partial<PublicProfile> = {}): PublicProfile {
  return {
    name: 'Chef Ana',
    handle: 'chef-ana',
    image: null,
    bio: null,
    links: [],
    recipes: [],
    social: { followerCount: 0, followingCount: 0, followers: [], following: [] },
    ...over,
  }
}

function renderProfile(profile: PublicProfile, locale = 'pt-BR') {
  return render(<PublicProfileView profile={profile} m={M} locale={locale} />)
}

describe('PublicProfileView (#129)', () => {
  it('renderiza nome + @handle; bio/links/receitas ausentes ⇒ tela limpa', () => {
    renderProfile(baseProfile())
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Chef Ana')
    expect(screen.getByText('@chef-ana')).toBeInTheDocument()
    // Sem bio nem links ⇒ blocos omitidos; receitas vazias ⇒ mensagem de "sem receitas".
    expect(screen.queryByRole('navigation', { name: M.perfilPublico.linksLabel })).toBeNull()
    expect(screen.getByText(M.perfilPublico.semReceitas)).toBeInTheDocument()
  })

  it('avatar de fallback (image NULL) usa iniciais; com image usa <img> com alt', () => {
    const { unmount } = renderProfile(baseProfile({ name: 'Ana Maria Braga' }))
    // Iniciais da 1ª e última palavra do nome.
    expect(screen.getByText('AB')).toBeInTheDocument()
    unmount()

    renderProfile(
      baseProfile({ name: 'Chef Ana', image: 'https://lh3.googleusercontent.com/a.jpg' }),
    )
    const img = screen.getByRole('img', { name: M.perfilPublico.avatarAlt.replace('{name}', 'Chef Ana') })
    expect(img).toHaveAttribute('src', 'https://lh3.googleusercontent.com/a.jpg')
  })

  it('renderiza a bio quando presente', () => {
    renderProfile(baseProfile({ bio: 'Cozinho todo dia.' }))
    expect(screen.getByText('Cozinho todo dia.')).toBeInTheDocument()
  })

  it('links: clicáveis com rel="noopener noreferrer" + target=_blank; href só http(s) seguro', () => {
    renderProfile(
      baseProfile({
        links: [
          { tipo: 'instagram', url: 'https://instagram.com/chef' },
          // Esquema perigoso: re-guardado por safeHttpUrl ⇒ NÃO emite href (filtrado).
          { tipo: 'site', url: 'javascript:alert(1)' },
        ],
      }),
    )
    const nav = screen.getByRole('navigation', { name: M.perfilPublico.linksLabel })
    // O link agora mostra "Tipo · valor" (protótipo); o nome acessível CONTÉM o rótulo do tipo.
    const insta = within(nav).getByRole('link', { name: new RegExp(M.perfil.linkTipoInstagram, 'i') })
    expect(insta).toHaveAttribute('href', 'https://instagram.com/chef')
    expect(insta).toHaveAttribute('rel', 'noopener noreferrer')
    expect(insta).toHaveAttribute('target', '_blank')
    // O link perigoso foi filtrado (defesa-em-profundidade): só 1 link sobrou.
    expect(within(nav).getAllByRole('link')).toHaveLength(1)
    // Nenhum href javascript: na árvore.
    for (const a of within(nav).getAllByRole('link')) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/^javascript:/i)
    }
  })

  it('lista as receitas públicas como cards linkando o detalhe canônico (#231)', () => {
    renderProfile(
      baseProfile({
        recipes: [
          // Com slug: linka o canônico /{locale}/recipes/<slug> (#231/ADR-0020).
          { recipeId: 'r-1', displayedTitle: 'Bolo de fubá', origin: 'ai_chat', slug: 'bolo-de-fuba' },
          // Sem slug naquele locale: fallback canônico por UUID /{locale}/recipes/<uuid> (308a), nunca nu.
          { recipeId: 'r-2', displayedTitle: 'Pão caseiro', origin: 'user_edited' },
        ],
      }),
    )
    expect(screen.queryByText(M.perfilPublico.semReceitas)).toBeNull()
    const card1 = screen.getByText('Bolo de fubá').closest('a')
    expect(card1).toHaveAttribute('href', '/pt-BR/recipes/bolo-de-fuba')
    const card2 = screen.getByText('Pão caseiro').closest('a')
    expect(card2).toHaveAttribute('href', '/pt-BR/recipes/r-2')
    expect(card2).not.toHaveAttribute('href', '/recipes/r-2')
  })

  it('linha de stats estilo Instagram: receitas (de recipes.length) · seguidores · seguindo, com âncoras', () => {
    renderProfile(
      baseProfile({
        recipes: [
          { recipeId: 'r-1', displayedTitle: 'Bolo de fubá', origin: 'ai_chat', slug: 'bolo-de-fuba' },
          { recipeId: 'r-2', displayedTitle: 'Pão caseiro', origin: 'user_edited', slug: 'pao-caseiro' },
        ],
        social: {
          followerCount: 2,
          followingCount: 1,
          followers: [
            { name: 'Bob', handle: 'bob', image: null },
            { name: 'Cara', handle: 'cara', image: null },
          ],
          following: [{ name: 'Dan', handle: 'dan', image: null }],
        },
      }),
    )
    // O contador de receitas vem de profile.recipes.length (sem nova query) → "2 receitas".
    const receitas = screen.getByRole('link', { name: M.perfilPublico.receitasContagem.replace('{n}', '2') })
    expect(receitas).toHaveAttribute('href', '#perfil-receitas')
    const seguidores = screen.getByRole('link', { name: M.perfilPublico.seguidoresContagem.replace('{n}', '2') })
    expect(seguidores).toHaveAttribute('href', '#perfil-seguidores')
    const seguindo = screen.getByRole('link', { name: M.perfilPublico.seguindoContagem.replace('{n}', '1') })
    expect(seguindo).toHaveAttribute('href', '#perfil-seguindo')
    // As seções-alvo existem na MESMA página (acoplamento contador ⇄ âncora).
    expect(document.getElementById('perfil-receitas')).not.toBeNull()
    expect(document.getElementById('perfil-seguidores')).not.toBeNull()
    expect(document.getElementById('perfil-seguindo')).not.toBeNull()
  })

  // BUG 2: a foto de capa carrega no card do perfil (era o branch placeholder por falta de imageUrl).
  it('receita COM imageUrl renderiza <img> (não o placeholder); alt === título', () => {
    renderProfile(
      baseProfile({
        // avatar null ⇒ o ÚNICO <img> da árvore é a thumbnail da receita.
        recipes: [
          {
            recipeId: 'r-1',
            displayedTitle: 'Bolo de fubá',
            origin: 'ai_chat',
            imageUrl: 'https://abc.public.blob.vercel-storage.com/r/x.webp',
          },
        ],
      }),
    )
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'https://abc.public.blob.vercel-storage.com/r/x.webp')
    expect(img).toHaveAttribute('alt', 'Bolo de fubá')
  })

  it('receita gerada por IA mostra o selo "gerada por IA" sobre a foto (#132)', () => {
    renderProfile(
      baseProfile({
        recipes: [
          {
            recipeId: 'r-1',
            displayedTitle: 'Bolo de fubá',
            origin: 'ai_chat',
            imageUrl: 'https://x/y.webp',
            imageAiGenerated: true,
          },
        ],
      }),
    )
    expect(screen.getByText(M.busca.imagemSeloIa)).toBeInTheDocument()
  })

  it('receita SEM imageUrl ⇒ placeholder (queryByRole img é nulo, não <img> vazio)', () => {
    renderProfile(
      baseProfile({
        // avatar null + sem foto na receita ⇒ NENHUM <img> na árvore.
        recipes: [{ recipeId: 'r-1', displayedTitle: 'Pão caseiro', origin: 'user_edited' }],
      }),
    )
    expect(screen.queryByRole('img')).toBeNull()
  })

  // Linha de stats estilo Instagram: a ORDEM é receitas → seguidores → seguindo num único <p>, e o
  // BOTÃO vai numa LINHA ABAIXO (fora do <p>) — nunca encravado entre os contadores. Exatamente UM
  // aria-live (no número de seguidores, o único mutável; receitas/seguindo são estáticos SSR).
  it('a linha social: stats (receitas → seguidores → seguindo) + botão na LINHA ABAIXO', () => {
    const { container } = renderProfile(
      baseProfile({ social: { followerCount: 3, followingCount: 5, followers: [], following: [] } }),
    )
    const receitasTxt = M.perfilPublico.receitasContagem.replace('{n}', '0')
    const seguidoresTxt = M.perfilPublico.seguidoresContagem.replace('{n}', '3')
    const seguindoTxt = M.perfilPublico.seguindoContagem.replace('{n}', '5')
    // A linha de stats é o <p> que contém o contador de seguidores; ordem: receitas → seguidores → seguindo.
    const statsP = screen.getByRole('link', { name: seguidoresTxt }).closest('p') as HTMLElement
    expect(statsP.textContent?.replace(/\s+/g, ' ')).toMatch(
      new RegExp(`${receitasTxt}[\\s\\S]*${seguidoresTxt}[\\s\\S]*${seguindoTxt}`),
    )
    // O botão (nudge anon "Entrar para seguir") fica FORA do <p> de stats (numa linha abaixo).
    expect(within(statsP).queryByText(M.perfilPublico.entrarParaSeguir)).toBeNull()
    expect(screen.getByText(M.perfilPublico.entrarParaSeguir)).toBeInTheDocument()
    // aria-live SÓ no NÚMERO de seguidores (o único mutável). Um único nó na árvore inteira.
    const live = container.querySelectorAll('[aria-live]')
    expect(live).toHaveLength(1)
    expect(live[0]).toHaveTextContent('3')
  })
})
