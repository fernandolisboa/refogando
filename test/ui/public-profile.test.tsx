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
    ...over,
  }
}

function renderProfile(profile: PublicProfile) {
  return render(<PublicProfileView profile={profile} m={M} />)
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
    const insta = within(nav).getByRole('link', { name: M.perfil.linkTipoInstagram })
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

  it('lista as receitas públicas como cards linkando o detalhe', () => {
    renderProfile(
      baseProfile({
        recipes: [
          { recipeId: 'r-1', displayedTitle: 'Bolo de fubá', origin: 'ai_chat' },
          { recipeId: 'r-2', displayedTitle: 'Pão caseiro', origin: 'user_edited' },
        ],
      }),
    )
    expect(screen.queryByText(M.perfilPublico.semReceitas)).toBeNull()
    const card1 = screen.getByText('Bolo de fubá').closest('a')
    expect(card1).toHaveAttribute('href', '/recipes/r-1')
    const card2 = screen.getByText('Pão caseiro').closest('a')
    expect(card2).toHaveAttribute('href', '/recipes/r-2')
  })
})
