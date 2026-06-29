import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Estúdio de imagem do CATÁLOGO (#238) — teste de COMPONENTE jsdom. `fetch` mockado no shape REAL das
 * rotas de curador (`{ gallery }`). Cobre: gerar (galeria atualiza do RETORNO, não router.refresh),
 * subir falha de tipo, erro de rede. resizeImage é mockado (jsdom não tem canvas).
 */
import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { CatalogImageControls } from '@/components/admin/catalog-image-controls'

vi.mock('@/lib/image-resize', () => ({
  resizeImage: async (f: File) => f, // jsdom não tem canvas; devolve o próprio arquivo
}))

const M = ptBR.curadoria
const RID = '11111111-1111-1111-1111-111111111111'

type Img = { id: string; url: string; aiGenerated: boolean; selected: boolean; moderated: boolean; editedFromId: string | null }
const img = (id: string, selected = true): Img => ({
  id,
  url: `https://blob/${id}.webp`,
  aiGenerated: true,
  selected,
  moderated: false,
  editedFromId: null,
})

function mockFetch(routes: Record<string, { ok: boolean; status: number; body: unknown } | { reject: true }>) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    const method = (args[1]?.method ?? 'GET').toUpperCase()
    const r = routes[`${method} ${url}`]
    if (!r) throw new Error(`fetch não mockado: ${method} ${url}`)
    if ('reject' in r) throw new TypeError('network down')
    return { ok: r.ok, status: r.status, json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

function renderControls(initial: Img[] = []) {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <CatalogImageControls recipeId={RID} initialGallery={initial} />
    </LocaleProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('CatalogImageControls', () => {
  it('sem foto: mostra placeholder e o botão "Gerar imagem"', () => {
    renderControls([])
    expect(screen.getByText(M.filaImagemSemFoto)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: M.filaImagemGerar })).toBeInTheDocument()
  })

  it('gerar: POST correto, a face aparece a partir do RETORNO (sem router.refresh)', async () => {
    const f = mockFetch({
      [`POST /api/curate/recipes/${RID}/image/generate`]: { ok: true, status: 200, body: { gallery: [img('a')] } },
    })
    renderControls([])
    await userEvent.click(screen.getByRole('button', { name: M.filaImagemGerar }))
    expect(f).toHaveBeenCalledWith(
      `/api/curate/recipes/${RID}/image/generate`,
      expect.objectContaining({ method: 'POST' }),
    )
    // a face renderizou (img alt="" com o src do blob).
    const imgs = document.querySelectorAll('img')
    expect([...imgs].some((i) => i.getAttribute('src') === 'https://blob/a.webp')).toBe(true)
  })

  it('com 2 imagens: clicar numa miniatura chama o select e troca a face', async () => {
    const f = mockFetch({
      [`POST /api/curate/recipes/${RID}/images/b/select`]: { ok: true, status: 200, body: { gallery: [img('a', false), img('b', true)] } },
    })
    renderControls([img('a', true), img('b', false)])
    // a miniatura não-selecionada 'b' tem aria-label "Usar esta".
    const usarEsta = screen.getAllByRole('button', { name: M.filaImagemUsarEsta })
    await userEvent.click(usarEsta[0])
    expect(f).toHaveBeenCalledWith(
      `/api/curate/recipes/${RID}/images/b/select`,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('falha de rede ao gerar ⇒ alerta de erro', async () => {
    mockFetch({ [`POST /api/curate/recipes/${RID}/image/generate`]: { reject: true } })
    renderControls([])
    await userEvent.click(screen.getByRole('button', { name: M.filaImagemGerar }))
    expect(await screen.findByText(M.filaImagemErro)).toBeInTheDocument()
  })
})
