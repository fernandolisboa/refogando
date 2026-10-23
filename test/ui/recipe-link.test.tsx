import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

/**
 * ADR-0053: o `RecipeLink` pede a página INTEIRA (`router.prefetch` com `kind: 'full'`) quando o mouse para
 * `HOVER_DWELL_MS` sobre o link — nunca no toque, nunca de passagem — e mostra a barra fina no topo enquanto o
 * clique espera o servidor (`useLinkStatus().pending`). O mock do Link deixa o teste escolher o `pending`.
 */
let pending = false
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending }),
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
const prefetch = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ prefetch }) }))

import { HOVER_DWELL_MS, RecipeLink } from '@/components/recipe/recipe-link'

beforeEach(() => {
  pending = false
  prefetch.mockClear()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

const HREF = '/pt-BR/recipes/ramen-shoyu'

describe('RecipeLink (ADR-0053)', () => {
  it('mantém href, className e o mouseenter de quem chama', () => {
    const onMouseEnter = vi.fn()
    render(
      <RecipeLink href={HREF} className="card" onMouseEnter={onMouseEnter}>
        Ramen
      </RecipeLink>,
    )
    const link = screen.getByRole('link', { name: 'Ramen' })
    expect(link).toHaveAttribute('href', HREF)
    expect(link).toHaveClass('card')
    fireEvent.mouseEnter(link)
    expect(onMouseEnter).toHaveBeenCalledOnce()
  })

  it('mouse parado sobre o link ⇒ pré-carrega a página inteira, uma vez', () => {
    render(<RecipeLink href={HREF}>Ramen</RecipeLink>)
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Ramen' }))
    act(() => vi.advanceTimersByTime(HOVER_DWELL_MS - 1))
    expect(prefetch).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(prefetch).toHaveBeenCalledOnce()
    expect(prefetch).toHaveBeenCalledWith(HREF, { kind: 'full' })
  })

  it('mouse só de passagem ⇒ nada', () => {
    render(<RecipeLink href={HREF}>Ramen</RecipeLink>)
    const link = screen.getByRole('link', { name: 'Ramen' })
    fireEvent.mouseEnter(link)
    act(() => vi.advanceTimersByTime(HOVER_DWELL_MS / 2))
    fireEvent.mouseLeave(link)
    act(() => vi.advanceTimersByTime(HOVER_DWELL_MS * 5))
    expect(prefetch).not.toHaveBeenCalled()
  })

  it('toque (rolagem no celular) ⇒ não pede a página inteira', () => {
    render(<RecipeLink href={HREF}>Ramen</RecipeLink>)
    fireEvent.touchStart(screen.getByRole('link', { name: 'Ramen' }))
    act(() => vi.advanceTimersByTime(HOVER_DWELL_MS * 5))
    expect(prefetch).not.toHaveBeenCalled()
  })

  it('desmontar com o mouse em cima ⇒ cancela o pré-carregamento', () => {
    const { unmount } = render(<RecipeLink href={HREF}>Ramen</RecipeLink>)
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Ramen' }))
    unmount()
    act(() => vi.advanceTimersByTime(HOVER_DWELL_MS * 5))
    expect(prefetch).not.toHaveBeenCalled()
  })

  it('sem navegação pendente, nenhuma barra', () => {
    render(<RecipeLink href={HREF}>X</RecipeLink>)
    expect(document.querySelector('.nav-pending-bar')).toBeNull()
  })

  it('com o clique esperando o servidor, a barra vai para o <body> (fora do card) e fica escondida do leitor de tela', () => {
    pending = true
    render(<RecipeLink href={HREF}>X</RecipeLink>)
    const bar = document.querySelector('.nav-pending-bar')
    expect(bar).not.toBeNull()
    expect(bar?.parentElement).toBe(document.body)
    expect(bar).toHaveAttribute('aria-hidden')
    expect(screen.getByRole('link', { name: 'X' }).contains(bar)).toBe(false)
  })
})
