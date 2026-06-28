import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { RecommendedCook } from '@/domain/recommended-cooks-read'

/**
 * Hook `useRecommendedCooks` (#278, ADR-0024 emendado) — o fetch ELEVADO do trilho. Cobre o gate Modelo B
 * (anon/pendente ⇒ nada, sem fetch — a home anon/indexável fica byte-idêntica) e o fetch logado COM
 * `?locale=` (o preview de receitas traz títulos localizados).
 */

type SessionState = { data: unknown; error: unknown; isPending: boolean }
let sessionState: SessionState
vi.mock('@/lib/auth-client', () => ({ useSession: () => sessionState }))

import { LocaleProvider } from '@/i18n/provider'
import { useRecommendedCooks } from '@/components/recipe/use-recommended-cooks'

const authed: SessionState = { data: { user: { id: 'u-1' } }, error: null, isPending: false }
const anon: SessionState = { data: null, error: null, isPending: false }
const pending: SessionState = { data: null, error: null, isPending: true }

function cook(handle: string): RecommendedCook {
  return { handle, name: handle, image: null, recipeCount: 1, recipes: [] }
}

function mockFetch(cooks: RecommendedCook[]) {
  const impl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ cooks }) }) as Response)
  vi.stubGlobal('fetch', impl)
  return impl as unknown as ReturnType<typeof vi.fn>
}

// Wrapper NOMEADO (react/display-name) que lê o locale de uma variável de módulo (setada por teste).
let wrapperLocale: 'pt-BR' | 'en-US' = 'pt-BR'
function Wrapper({ children }: { children: ReactNode }) {
  return <LocaleProvider initialLocale={wrapperLocale}>{children}</LocaleProvider>
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  wrapperLocale = 'pt-BR'
})

describe('useRecommendedCooks (#278)', () => {
  it('Visitante: NÃO busca e devolve cooks [] (Modelo B)', () => {
    sessionState = anon
    const fetchMock = mockFetch([cook('a'), cook('b'), cook('c')])
    const { result } = renderHook(() => useRecommendedCooks(), { wrapper: Wrapper })
    expect(result.current.cooks).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sessão pendente (SSR-like): NÃO busca', () => {
    sessionState = pending
    const fetchMock = mockFetch([cook('a')])
    const { result } = renderHook(() => useRecommendedCooks(), { wrapper: Wrapper })
    expect(result.current.cooks).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('logado: busca /api/discovery/cooks?locale=pt-BR e devolve os cooks', async () => {
    sessionState = authed
    const fetchMock = mockFetch([cook('rita'), cook('beto'), cook('ana')])
    const { result } = renderHook(() => useRecommendedCooks(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.cooks).toHaveLength(3))
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/api/discovery/cooks')
    expect(url).toContain('locale=pt-BR')
  })

  it('logado em en-US: o fetch leva ?locale=en-US (preview localizado)', async () => {
    sessionState = authed
    wrapperLocale = 'en-US'
    const fetchMock = mockFetch([cook('rita')])
    const { result } = renderHook(() => useRecommendedCooks(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.cooks).toHaveLength(1))
    expect(String(fetchMock.mock.calls[0][0])).toContain('locale=en-US')
  })
})
