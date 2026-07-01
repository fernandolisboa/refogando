import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Teste de COMPONENTE jsdom da seção de Avaliações (#363) — seam de frontend (#54, sem
 * browser/Postgres). `fetch` mockado por URL (GET /reviews/mine hidrata o viewer; POST/DELETE
 * /reviews + GET /reviews refrescam). `next/link` mockado; locale real (LocaleProvider).
 * ADR-0015: SEM âmbar (`aviso-*`) e SEM accent — provado pela ausência das classes.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

const authMock = vi.hoisted(() => ({
  session: { data: null as unknown, isPending: false, error: null as unknown },
}))
vi.mock('@/lib/auth-client', () => ({
  useSession: () => authMock.session,
}))

function setSession(state: 'logged-in' | 'anon' | 'pending') {
  authMock.session =
    state === 'logged-in'
      ? { data: { user: { id: 'u1' } }, isPending: false, error: null }
      : state === 'anon'
        ? { data: null, isPending: false, error: null }
        : { data: null, isPending: true, error: null }
}

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import type { Locale } from '@/i18n/locale'
import {
  RecipeReviewSection,
  type ReviewViewSerialized,
} from '@/components/recipe/recipe-review-section'

const M = ptBR.avaliacoes

/** Mocka `fetch` por URL: um mapa de sufixo→resposta. `mine` só GET; `reviews` POST/DELETE/GET. */
function mockFetchByUrl(handlers: {
  mine?: { viewerReview: { rating: number; comment: string | null } | null; isOwner: boolean }
  save?: unknown
  list?: unknown
  fail?: boolean
}) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    const method = ((args[1] as RequestInit | undefined)?.method ?? 'GET').toUpperCase()
    if (url.endsWith('/reviews/mine')) {
      return { ok: true, status: 200, json: async () => handlers.mine ?? { viewerReview: null, isOwner: false } } as Response
    }
    if (url.endsWith('/reviews')) {
      if (handlers.fail && method !== 'GET') {
        return { ok: false, status: 400, json: async () => ({ error: 'dados_invalidos' }) } as Response
      }
      const body = method === 'GET' ? (handlers.list ?? { average: null, count: 0, reviews: [] }) : handlers.save
      return { ok: true, status: 200, json: async () => body } as Response
    }
    throw new Error(`fetch não mockado: ${url} ${method}`)
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

function makeReview(over: Partial<ReviewViewSerialized> = {}): ReviewViewSerialized {
  return {
    id: over.id ?? crypto.randomUUID(),
    rating: over.rating ?? 5,
    comment: over.comment ?? null,
    author: over.author ?? { name: 'Ana', handle: 'ana' },
    createdAt: over.createdAt ?? new Date().toISOString(),
  }
}

function renderSection(opts: {
  initialReviews?: ReviewViewSerialized[]
  initialAverage?: number | null
  initialCount?: number
  canManage?: boolean
  locale?: Locale
} = {}) {
  const {
    initialReviews = [],
    initialAverage = null,
    initialCount = 0,
    canManage = false,
    locale = 'pt-BR',
  } = opts
  return render(
    <LocaleProvider initialLocale={locale}>
      <RecipeReviewSection
        recipeId="r-1"
        initialReviews={initialReviews}
        initialAverage={initialAverage}
        initialCount={initialCount}
        canManage={canManage}
      />
    </LocaleProvider>,
  )
}

beforeEach(() => {
  setSession('anon')
  mockFetchByUrl({})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('RecipeReviewSection (#363)', () => {
  it('renderiza média/contagem (vírgula pt-BR) + lista a partir dos props', () => {
    renderSection({
      initialAverage: 4.5,
      initialCount: 2,
      initialReviews: [
        makeReview({ rating: 5, comment: 'delícia', author: { name: 'Ana', handle: 'ana' } }),
        makeReview({ rating: 4, comment: null, author: { name: 'Beto', handle: 'beto' } }),
      ],
    })
    expect(screen.getByText('★ 4,5 · 2 avaliações')).toBeInTheDocument()
    expect(screen.getByText('delícia')).toBeInTheDocument()
    // byline linka /u/handle.
    expect(screen.getByRole('link', { name: 'Ana' })).toHaveAttribute('href', '/u/ana')
  })

  it('contagem 1 usa a chave singular', () => {
    renderSection({ initialAverage: 5, initialCount: 1, initialReviews: [makeReview()] })
    expect(screen.getByText('★ 5,0 · 1 avaliação')).toBeInTheDocument()
  })

  it('vazio ⇒ mensagem semAvaliacoes', () => {
    renderSection({})
    expect(screen.getByText(M.semAvaliacoes)).toBeInTheDocument()
  })

  it('anônimo ⇒ convite "Entrar para avaliar" (link /sign-in), sem widget', () => {
    setSession('anon')
    renderSection({ initialAverage: 5, initialCount: 1, initialReviews: [makeReview()] })
    expect(screen.getByRole('link', { name: M.convidaEntrar })).toHaveAttribute('href', '/sign-in')
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('dono (canManage) ⇒ sem widget nem convite (auto-avaliação barrada)', () => {
    setSession('logged-in')
    renderSection({ canManage: true, initialAverage: 5, initialCount: 1, initialReviews: [makeReview()] })
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.queryByRole('link', { name: M.convidaEntrar })).toBeNull()
  })

  it('logado não-dono COM avaliação (mock /mine) ⇒ prefill + Editar/Apagar', async () => {
    setSession('logged-in')
    mockFetchByUrl({ mine: { viewerReview: { rating: 3, comment: 'boa' }, isOwner: false } })
    renderSection({ initialAverage: 3, initialCount: 1 })

    // Prefill do comentário + botões de edição.
    expect(await screen.findByDisplayValue('boa')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: M.editar })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: M.apagar })).toBeInTheDocument()
    // Estrela 3 marcada.
    const stars = screen.getAllByRole('radio')
    expect(stars[2]).toHaveAttribute('aria-checked', 'true')
  })

  it('envio otimista chama POST /reviews e reflete a resposta', async () => {
    const user = userEvent.setup()
    setSession('logged-in')
    const fetchMock = mockFetchByUrl({
      mine: { viewerReview: null, isOwner: false },
      save: { average: 5, count: 1, viewerRating: 5, viewerComment: null },
      list: { average: 5, count: 1, reviews: [makeReview({ rating: 5 })] },
    })
    renderSection({})

    // Espera o widget (radiogroup) aparecer após o /mine.
    const stars = await screen.findAllByRole('radio')
    await user.click(stars[4]) // nota 5
    await user.click(screen.getByRole('button', { name: M.enviar }))

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c) => String(c[0]) === '/api/recipes/r-1/reviews' && (c[1] as RequestInit)?.method === 'POST',
        ),
      ).toBe(true),
    )
    expect(await screen.findByText('★ 5,0 · 1 avaliação')).toBeInTheDocument()
  })

  it('erro no envio ⇒ mensagem neutra única, sem âmbar/accent', async () => {
    const user = userEvent.setup()
    setSession('logged-in')
    const { container } = (() => {
      mockFetchByUrl({ mine: { viewerReview: null, isOwner: false }, fail: true })
      return renderSection({})
    })()

    const stars = await screen.findAllByRole('radio')
    await user.click(stars[0]) // nota 1
    await user.click(screen.getByRole('button', { name: M.enviar }))

    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroEnviar)
    expect(container.querySelector('[class*="aviso"]')).toBeNull()
    expect(container.querySelector('[class*="accent"]')).toBeNull()
  })
})
