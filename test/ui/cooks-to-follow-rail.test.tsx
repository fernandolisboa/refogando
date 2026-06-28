import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { RecommendedCook } from '@/domain/recommended-cooks-read'

/**
 * Trilho "Cozinheiros em alta" (#278, ADR-0024 emendado) — agora APRESENTACIONAL (recebe `cooks` por
 * prop; o fetch + o gate de sessão vivem no hook `useRecommendedCooks`, testado à parte). Cobre o cartão
 * rico: cabeçalho (nome, `@handle · N receitas`, Seguir, link de perfil), as receitas do preview (título
 * serif + selo de IA acessível) e o clique Seguir (POST otimista, via `useFollowToggle`).
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

// `useFollowToggle` (dentro do CookFollowButton) usa `useSession` p/ o POST otimista — mock logado.
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'u-1' } }, error: null, isPending: false }),
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { CooksToFollowRail } from '@/components/recipe/cooks-to-follow-rail'

const M = ptBR.cozinheirosSugeridos
const AI = ptBR.busca.imagemSeloIa

function cook(
  handle: string,
  name: string,
  opts: { recipeCount?: number; recipes?: RecommendedCook['recipes'] } = {},
): RecommendedCook {
  return {
    handle,
    name,
    image: null,
    recipeCount: opts.recipeCount ?? 2,
    recipes: opts.recipes ?? [],
  }
}

/** Mock do fetch SÓ pro toggle de seguir (a rota /api/u/.../follow). O trilho não busca mais (é prop). */
function mockFollowFetch() {
  const impl = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    return {
      ok: true,
      status: 200,
      json: async () => ({ isFollowing: (init?.method ?? 'POST') === 'POST', followerCount: 1 }),
    } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

function renderRail(cooks: RecommendedCook[]) {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <CooksToFollowRail cooks={cooks} />
    </LocaleProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CooksToFollowRail (#278) — cartão rico (apresentacional)', () => {
  it('cooks vazio: renderiza NADA (defesa — o pai já gateia)', () => {
    const { container } = renderRail([])
    expect(screen.queryByText(M.titulo)).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })

  it('mostra o título da seção + cartões (nome, @handle · N receitas, Seguir, link de perfil)', () => {
    mockFollowFetch()
    renderRail([
      cook('ritacozinha', 'Rita Souza', { recipeCount: 1 }),
      cook('betonacozinha', 'Beto Lima', { recipeCount: 5 }),
      cook('anaprado', 'Ana Prado', { recipeCount: 2 }),
    ])
    expect(screen.getByText(M.titulo)).toBeInTheDocument()
    expect(screen.getByText('Rita Souza')).toBeInTheDocument()
    expect(screen.getByText('@betonacozinha')).toBeInTheDocument()
    // `@handle · N receitas` numa única linha, mas a contagem segue queryável (span próprio).
    expect(screen.getByText(M.receitaContagem.replace('{n}', '1'))).toBeInTheDocument()
    expect(screen.getByText(M.receitasContagem.replace('{n}', '5'))).toBeInTheDocument()
    // um botão Seguir por cartão
    expect(screen.getAllByRole('button', { name: M.seguir })).toHaveLength(3)
    // link pro perfil público
    expect(screen.getByRole('link', { name: /Rita Souza/ })).toHaveAttribute('href', '/u/ritacozinha')
  })

  it('renderiza as receitas do preview (título serif) + selo de IA ACESSÍVEL (aiLabel sr-only)', () => {
    mockFollowFetch()
    renderRail([
      cook('rita', 'Rita', {
        recipeCount: 2,
        recipes: [
          { recipeId: 'r1', displayedTitle: 'Strogonoff de frango', imageAiGenerated: true },
          { recipeId: 'r2', displayedTitle: 'Frango xadrez caseiro' },
        ],
      }),
      cook('beto', 'Beto'),
      cook('ana', 'Ana'),
    ])
    expect(screen.getByText('Strogonoff de frango')).toBeInTheDocument()
    expect(screen.getByText('Frango xadrez caseiro')).toBeInTheDocument()
    // o selo de IA da receita gerada traz o rótulo localizado p/ leitor de tela (disclosure de IA).
    expect(screen.getByText(AI)).toBeInTheDocument()
  })

  it('clicar Seguir: POST e flip para "Seguindo" (otimista, sem GET por item)', async () => {
    const fetchMock = mockFollowFetch()
    const user = userEvent.setup()
    renderRail([cook('ana', 'Ana'), cook('beto', 'Beto'), cook('caio', 'Caio')])
    const botoes = await screen.findAllByRole('button', { name: M.seguir })
    await user.click(botoes[0])
    expect(await screen.findByRole('button', { name: M.seguindo })).toBeInTheDocument()
    // só o POST do clique (nenhum GET de estado por item).
    const followCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/u/'))
    expect(followCalls).toHaveLength(1)
    expect((followCalls[0][1] as RequestInit | undefined)?.method).toBe('POST')
  })

  it('estado SEGUINDO não herda a tinta de páprica do "Seguir" (legível, não páprica-sobre-páprica)', async () => {
    mockFollowFetch()
    const user = userEvent.setup()
    renderRail([cook('ana', 'Ana'), cook('beto', 'Beto'), cook('caio', 'Caio')])
    const seguir = (await screen.findAllByRole('button', { name: M.seguir }))[0]
    // "Seguir" (não-seguindo) = contornado com tinta de marca (páprica).
    expect(seguir).toHaveClass('text-brand-ink')
    await user.click(seguir)
    // "Seguindo" (default, fundo páprica) NÃO pode carregar text-brand-ink — senão o texto fica invisível.
    const seguindo = await screen.findByRole('button', { name: M.seguindo })
    expect(seguindo).not.toHaveClass('text-brand-ink')
  })
})
