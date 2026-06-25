import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { ProfileFollowUser } from '@/domain/recipe-profile-read'

/**
 * Cluster de Cozinheiros (#279) — apresentacional puro. Vazio → null; cartões linkam /u/handle;
 * "Ver todos" revela além do colapsado e alterna pra "Ver menos".
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { CookSearchCluster, COOK_CLUSTER_COLLAPSED } from '@/components/recipe/cook-search-cluster'

const M = ptBR.buscaCozinheiros

function cook(handle: string, name: string): ProfileFollowUser {
  return { handle, name, image: null }
}

function renderCluster(cooks: ProfileFollowUser[]) {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <CookSearchCluster cooks={cooks} />
    </LocaleProvider>,
  )
}

describe('CookSearchCluster (#279)', () => {
  it('vazio → renderiza NADA (sem heading órfão)', () => {
    const { container } = renderCluster([])
    expect(container).toBeEmptyDOMElement()
  })

  it('com cooks → heading + cartões (nome, @handle, link /u/handle)', () => {
    renderCluster([cook('ana', 'Ana'), cook('beto', 'Beto')])
    expect(screen.getByRole('heading', { name: M.titulo })).toBeInTheDocument()
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('@beto')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ana/ })).toHaveAttribute('href', '/u/ana')
  })

  it('<= COLLAPSED → sem "Ver todos"', () => {
    const cooks = Array.from({ length: COOK_CLUSTER_COLLAPSED }, (_, i) => cook(`c${i}`, `Cook ${i}`))
    renderCluster(cooks)
    expect(screen.queryByRole('button', { name: M.verTodos })).toBeNull()
  })

  it('> COLLAPSED → "Ver todos" revela o resto e alterna pra "Ver menos"', async () => {
    const total = COOK_CLUSTER_COLLAPSED + 2
    const cooks = Array.from({ length: total }, (_, i) => cook(`c${i}`, `Cook ${i}`))
    const user = userEvent.setup()
    renderCluster(cooks)

    // Colapsado: só COLLAPSED cartões visíveis.
    expect(screen.getAllByRole('link').length).toBe(COOK_CLUSTER_COLLAPSED)
    const verTodos = screen.getByRole('button', { name: M.verTodos })
    await user.click(verTodos)
    // Expandido: todos visíveis + botão vira "Ver menos".
    expect(screen.getAllByRole('link').length).toBe(total)
    expect(screen.getByRole('button', { name: M.verMenos })).toBeInTheDocument()
  })
})
