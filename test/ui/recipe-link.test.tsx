import type { ReactNode } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * ADR-0053: o `RecipeLink` pede ao `<Link>` o pré-carregamento completo no hover (`unstable_dynamicOnHover`) e mostra
 * a barra fina no topo enquanto o clique espera o servidor (`useLinkStatus().pending`). O mock grava as props que o
 * Link recebeu e deixa o teste escolher o `pending`.
 */
let pending = false
const linkProps: Record<string, unknown>[] = []
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending }),
  default: ({ href, children, unstable_dynamicOnHover, ...rest }: { href: string; children: ReactNode; unstable_dynamicOnHover?: boolean }) => {
    linkProps.push({ href, unstable_dynamicOnHover })
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  },
}))

import { RecipeLink } from '@/components/recipe/recipe-link'

beforeEach(() => {
  pending = false
  linkProps.length = 0
})

describe('RecipeLink (ADR-0053)', () => {
  it('pede o pré-carregamento completo no hover e mantém href e className', () => {
    render(
      <RecipeLink href="/pt-BR/recipes/ramen-shoyu" className="card">
        Ramen
      </RecipeLink>,
    )
    const link = screen.getByRole('link', { name: 'Ramen' })
    expect(link).toHaveAttribute('href', '/pt-BR/recipes/ramen-shoyu')
    expect(link).toHaveClass('card')
    expect(linkProps.at(-1)).toEqual({ href: '/pt-BR/recipes/ramen-shoyu', unstable_dynamicOnHover: true })
  })

  it('sem navegação pendente, nenhuma barra', () => {
    render(<RecipeLink href="/pt-BR/recipes/x">X</RecipeLink>)
    expect(document.querySelector('.nav-pending-bar')).toBeNull()
  })

  it('com o clique esperando o servidor, a barra vai para o <body> (fora do card) e fica escondida do leitor de tela', () => {
    pending = true
    render(<RecipeLink href="/pt-BR/recipes/x">X</RecipeLink>)
    const bar = document.querySelector('.nav-pending-bar')
    expect(bar).not.toBeNull()
    expect(bar?.parentElement).toBe(document.body)
    expect(bar).toHaveAttribute('aria-hidden')
    expect(screen.getByRole('link', { name: 'X' }).contains(bar)).toBe(false)
  })
})
