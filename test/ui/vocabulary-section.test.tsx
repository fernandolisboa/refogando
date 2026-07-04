import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * VocabularySection (#321) — seam jsdom (#54). Monta a seção, lista as cozinhas (GET mockado),
 * adiciona uma (POST) e mapeia o erro 409 `slug_em_uso` pela CHAVE do corpo. Timers reais (o
 * load roda num setTimeout(0); usamos `findBy*` que espera).
 */
type FetchResult = { ok: boolean; status: number; body: unknown } | { reject: true }

function mockFetch(handler: (url: string, method: string, body: unknown) => FetchResult) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    const method = (args[1]?.method ?? 'GET').toUpperCase()
    const raw = args[1]?.body
    const body = typeof raw === 'string' ? JSON.parse(raw) : undefined
    const r = handler(url, method, body)
    if ('reject' in r) throw new TypeError('network down')
    return { ok: r.ok, status: r.status, json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { VocabularySection } from '@/components/admin/vocabulary-section'

const A = ptBR.admin

const BASELINE = [
  { slug: 'italiana', labelPtBr: 'Italiana', labelEnUs: 'Italian', voiceNote: null, status: 'active', sort: 0 },
  { slug: 'mexicana', labelPtBr: 'Mexicana', labelEnUs: 'Mexican', voiceNote: 'Milho e pimentas.', status: 'deprecated', sort: 5 },
]

function renderSection() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <VocabularySection />
    </LocaleProvider>,
  )
}

describe('VocabularySection (#321)', () => {
  it('lista as cozinhas com status e mostra o form de adicionar', async () => {
    mockFetch((url, method) => {
      if (method === 'GET' && url === '/api/admin/vocabulary') {
        return { ok: true, status: 200, body: { cozinhas: BASELINE } }
      }
      throw new Error(`fetch não mockado: ${method} ${url}`)
    })
    renderSection()

    expect(await screen.findByText('italiana')).toBeInTheDocument()
    expect(screen.getByText('mexicana')).toBeInTheDocument()
    // status depreciada visível.
    expect(screen.getByText(A.vocabStatusDepreciada)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: A.vocabAdicionar })).toBeInTheDocument()
  })

  it('adicionar uma cozinha faz POST e a insere na lista', async () => {
    const calls: Array<{ method: string; body: unknown }> = []
    mockFetch((url, method, body) => {
      if (method === 'GET') return { ok: true, status: 200, body: { cozinhas: BASELINE } }
      if (method === 'POST') {
        calls.push({ method, body })
        return {
          ok: true,
          status: 200,
          body: {
            cozinha: {
              slug: 'coreana',
              labelPtBr: 'Coreana',
              labelEnUs: 'Korean',
              status: 'active',
              sort: 6,
            },
          },
        }
      }
      throw new Error(`fetch não mockado: ${method} ${url}`)
    })
    renderSection()
    await screen.findByText('italiana')

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(A.vocabSlugLabel), 'coreana')
    await user.type(screen.getByLabelText(A.vocabRotuloPt), 'Coreana')
    await user.type(screen.getByLabelText(A.vocabRotuloEn), 'Korean')
    await user.click(screen.getByRole('button', { name: A.vocabAdicionar }))

    expect(await screen.findByText('coreana')).toBeInTheDocument()
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toMatchObject({ slug: 'coreana', labelPtBr: 'Coreana', labelEnUs: 'Korean' })
  })

  it('editar uma cozinha mostra a textarea de nota de voz e a inclui no PATCH (#422)', async () => {
    const calls: Array<{ method: string; body: Record<string, unknown> }> = []
    mockFetch((url, method, body) => {
      if (method === 'GET') return { ok: true, status: 200, body: { cozinhas: BASELINE } }
      if (method === 'PATCH') {
        calls.push({ method, body: body as Record<string, unknown> })
        return {
          ok: true,
          status: 200,
          body: {
            cozinha: {
              slug: 'italiana',
              labelPtBr: 'Italiana',
              labelEnUs: 'Italian',
              voiceNote: 'Massa fresca e azeite.',
              status: 'active',
              sort: 0,
            },
          },
        }
      }
      throw new Error(`fetch não mockado: ${method} ${url}`)
    })
    renderSection()
    await screen.findByText('italiana')

    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: A.vocabEditar })[0])

    // A textarea de nota de voz aparece no bloco de edição inline.
    const nota = await screen.findByLabelText(A.vocabNotaVoz)
    expect(nota).toBeInTheDocument()
    await user.type(nota, 'Massa fresca e azeite.')
    await user.click(screen.getByRole('button', { name: A.vocabSalvar }))

    expect(calls).toHaveLength(1)
    expect(calls[0].body).toMatchObject({
      slug: 'italiana',
      labelPtBr: 'Italiana',
      labelEnUs: 'Italian',
      voiceNote: 'Massa fresca e azeite.',
    })
  })

  it('editar uma cozinha com nota existente pré-preenche a textarea (#422)', async () => {
    mockFetch((url, method) => {
      if (method === 'GET') return { ok: true, status: 200, body: { cozinhas: BASELINE } }
      throw new Error(`fetch não mockado: ${method} ${url}`)
    })
    renderSection()
    await screen.findByText('mexicana')

    const user = userEvent.setup()
    // A 2ª linha (mexicana) tem voiceNote na baseline.
    await user.click(screen.getAllByRole('button', { name: A.vocabEditar })[1])
    const nota = await screen.findByLabelText(A.vocabNotaVoz)
    expect(nota).toHaveValue('Milho e pimentas.')
  })

  it('slug em uso → mostra a mensagem mapeada pela CHAVE do corpo (409)', async () => {
    mockFetch((url, method) => {
      if (method === 'GET') return { ok: true, status: 200, body: { cozinhas: BASELINE } }
      if (method === 'POST') return { ok: false, status: 409, body: { error: 'slug_em_uso' } }
      throw new Error(`fetch não mockado: ${method} ${url}`)
    })
    renderSection()
    await screen.findByText('italiana')

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(A.vocabSlugLabel), 'italiana')
    await user.type(screen.getByLabelText(A.vocabRotuloPt), 'X')
    await user.type(screen.getByLabelText(A.vocabRotuloEn), 'X')
    await user.click(screen.getByRole('button', { name: A.vocabAdicionar }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(A.vocabErroSlugEmUso)).toBeInTheDocument()
  })
})
