import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * #317 (ADR-0025): a faceta de Cozinha da Busca renderiza as opções vindas do leitor
 * data-driven (via `CozinhaVocabProvider`, semeado no servidor), NÃO mais do enum estático
 * `COZINHAS` × `messages.cozinhaLabel`. Prova: o rótulo threadado aparece, o fallback de
 * locale-ausente (slug cru) aparece, e uma cozinha FORA do provider NÃO é renderizada (se a
 * UI ainda iterasse `COZINHAS`, 'italiana' apareceria sempre).
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({
    data: null,
    error: null,
    isPending: false,
    isRefetching: false,
    refetch: vi.fn(),
  }),
}))

import { LocaleProvider } from '@/i18n/provider'
import { CozinhaVocabProvider } from '@/components/i18n/cozinha-vocab-provider'
import { SearchExperience } from '@/components/recipe/search-experience'
import { HomeSearchProvider } from '@/components/recipe/home-search-context'
import { HomeSearchBar } from '@/components/recipe/home-search-bar'

// Provider com DOIS termos: um com rótulo (Brasileira) e um cujo rótulo é o próprio slug
// (novacozinha) — modela o fallback de locale-ausente JÁ resolvido no servidor. 'italiana'
// está DE FORA de propósito (prova que a UI não itera mais o enum).
const VOCAB = [
  { value: 'brasileira', label: 'Brasileira' },
  { value: 'novacozinha', label: 'novacozinha' },
]

function renderSearch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ minhas: [], catalogo: [], comunidade: [] }) })) as unknown as typeof fetch,
  )
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <CozinhaVocabProvider value={VOCAB}>
        <HomeSearchProvider>
          <HomeSearchBar />
          <SearchExperience />
        </HomeSearchProvider>
      </CozinhaVocabProvider>
    </LocaleProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('faceta de Cozinha vem do leitor data-driven (#317)', () => {
  it('renderiza o rótulo threadado, o fallback-slug, e OMITE cozinha fora do provider', () => {
    renderSearch()

    // #5 (Direção C): a trilha é permanente (sem mais disclosure `<details>`); o jsdom não esconde por
    // CSS, então os chips de cozinha já estão no DOM — consulta direta. Rótulo threadado (Brasileira) E o
    // fallback servido como slug cru (novacozinha).
    expect(screen.getByLabelText('Brasileira')).toBeInTheDocument()
    expect(screen.getByLabelText('novacozinha')).toBeInTheDocument()

    // 'Italiana' NÃO está no provider → não renderiza (se a UI ainda iterasse COZINHAS, apareceria).
    expect(screen.queryByLabelText('Italiana')).toBeNull()
  })
})
