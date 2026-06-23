import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Teste jsdom do estúdio de imagem da receita (#130/#132/#222). `useRouter` mockado (refresh
 * espionado); `resizeImage` mockado (jsdom não tem canvas); `fetch` mockado no shape das rotas de
 * imagem. Cobre: labels Adicionar/Trocar; upload POST multipart + refresh; tipo recusado inline;
 * remover = DELETE /image + refresh; #222 preview-modal (gerar → preview; "Usar esta" → select;
 * "Gerar outra" → 2ª geração, preview trocado, sem select; fechar após gerar → refresh — DECISION 6);
 * galeria (lista + selo IA; clicar → select; apagar → DELETE; in_use → mensagem amigável). Cap 429
 * e 403 desligada surfam mensagem amigável.
 */

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
const resizeImage = vi.fn(async (f: File): Promise<Blob> => f)
vi.mock('@/lib/image-resize', () => ({ resizeImage: (f: File) => resizeImage(f) }))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { RecipeImageManager } from '@/components/recipe/recipe-image-manager'
import type { GalleryImage } from '@/domain/recipe-read'

const M = ptBR.detalhe
const RID = '11111111-1111-1111-1111-111111111111'
const IMG1 = '22222222-2222-2222-2222-222222222222'
const IMG2 = '33333333-3333-3333-3333-333333333333'

type FetchResult = { status: number; body?: unknown }
function mockFetch(byMethod: (method: string, url: string) => FetchResult) {
  const calls: { method: string; url: string; body: unknown }[] = []
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    const init = args[1] as RequestInit | undefined
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ method, url, body: init?.body })
    const r = byMethod(method, url)
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body ?? {} } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { impl, calls }
}

function renderManager(opts: { hasImage?: boolean; gallery?: GalleryImage[]; aiGenEnabled?: boolean } = {}) {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <RecipeImageManager
        recipeId={RID}
        hasImage={opts.hasImage ?? false}
        gallery={opts.gallery ?? []}
        aiGenEnabled={opts.aiGenEnabled ?? true}
      />
    </LocaleProvider>,
  )
}
function pngFile(name = 'p.png', type = 'image/png'): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type })
}

/** Promise controlável (pra travar o controle no estado 'enviando'/'gerando' e inspecionar). */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  refresh.mockClear()
  resizeImage.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

describe('RecipeImageManager — foto + galeria + preview (#130/#222)', () => {
  it('sem imagem: label "Adicionar foto", sem botão Remover', () => {
    renderManager({ hasImage: false })
    expect(screen.getByText(M.imagemAdicionar)).toBeInTheDocument()
    expect(screen.queryByText(M.imagemRemover)).not.toBeInTheDocument()
  })

  it('com imagem: label "Trocar foto" + botão Remover', () => {
    renderManager({ hasImage: true })
    expect(screen.getByText(M.imagemTrocar)).toBeInTheDocument()
    expect(screen.getByText(M.imagemRemover)).toBeInTheDocument()
  })

  it('#215 imagemGerar traz o ✨ (convenção de affordance de IA)', () => {
    expect(M.imagemGerar).toContain('✨')
  })

  it('reviewSuggested (#131) + imagem ⇒ mostra o aviso de revisar a foto', () => {
    render(
      <LocaleProvider initialLocale="pt-BR">
        <RecipeImageManager recipeId={RID} hasImage gallery={[]} reviewSuggested />
      </LocaleProvider>,
    )
    expect(screen.getByText(M.imagemRevisar)).toBeInTheDocument()
  })

  it('reviewSuggested SEM imagem ⇒ não mostra o aviso (nada a revisar)', () => {
    render(
      <LocaleProvider initialLocale="pt-BR">
        <RecipeImageManager recipeId={RID} hasImage={false} gallery={[]} reviewSuggested />
      </LocaleProvider>,
    )
    expect(screen.queryByText(M.imagemRevisar)).not.toBeInTheDocument()
  })

  it('upload válido: POST multipart para /api/recipes/[id]/image + router.refresh', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch((method) => (method === 'POST' ? { status: 200, body: { id: RID } } : { status: 405 }))
    renderManager({ hasImage: false })

    await user.upload(screen.getByLabelText(M.imagemAdicionar), pngFile())

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.url).toBe(`/api/recipes/${RID}/image`)
    expect(post.body).toBeInstanceOf(FormData)
    expect((post.body as FormData).get('file')).toBeInstanceOf(File)
    expect(resizeImage).toHaveBeenCalledOnce()
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('tipo recusado no client: erro inline, sem rede', async () => {
    const { impl } = mockFetch(() => ({ status: 200 }))
    renderManager({ hasImage: false })
    fireEvent.change(screen.getByLabelText(M.imagemAdicionar), { target: { files: [pngFile('a.gif', 'image/gif')] } })

    expect(await screen.findByText(M.imagemTipoInvalido)).toBeInTheDocument()
    expect(impl).not.toHaveBeenCalled()
    expect(resizeImage).not.toHaveBeenCalled()
  })

  it('remover (deselecionar): DELETE /api/recipes/[id]/image + router.refresh', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch((method) => (method === 'DELETE' ? { status: 200, body: { id: RID } } : { status: 405 }))
    renderManager({ hasImage: true })

    await user.click(screen.getByText(M.imagemRemover))

    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
    expect(calls.find((c) => c.method === 'DELETE')!.url).toBe(`/api/recipes/${RID}/image`)
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('falha do servidor no upload: erro inline e NÃO chama refresh', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 500 }))
    renderManager({ hasImage: false })

    await user.upload(screen.getByLabelText(M.imagemAdicionar), pngFile())

    expect(await screen.findByText(M.imagemErro)).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('resize acima do cap (2 MB): mostra imagemGrande e NÃO chama a rede', async () => {
    const user = userEvent.setup()
    const { impl } = mockFetch(() => ({ status: 200 }))
    resizeImage.mockResolvedValueOnce(new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/webp' }))
    renderManager({ hasImage: false })

    await user.upload(screen.getByLabelText(M.imagemAdicionar), pngFile())

    expect(await screen.findByText(M.imagemGrande)).toBeInTheDocument()
    expect(impl).not.toHaveBeenCalled()
  })

  // ── #134: geração ligada/desligada ──────────────────────────────────────────────
  it('#134 geração DESLIGADA (aiGenEnabled=false): esconde "Gerar com IA"; upload permanece', () => {
    renderManager({ hasImage: false, aiGenEnabled: false })
    expect(screen.queryByText(M.imagemGerar)).not.toBeInTheDocument()
    expect(screen.getByText(M.imagemAdicionar)).toBeInTheDocument()
  })

  it('#134 geração ligada (default): "Gerar com IA" aparece', () => {
    renderManager({ hasImage: false })
    expect(screen.getByText(M.imagemGerar)).toBeInTheDocument()
  })

  // ── #222: preview-modal ─────────────────────────────────────────────────────────
  it('#222 gerar abre o modal e POSTa /image/generate; mostra o preview; a face NÃO muda (sem select)', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch((method, url) =>
      method === 'POST' && url.endsWith('/image/generate')
        ? { status: 200, body: { image: { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: true } } }
        : { status: 405 },
    )
    renderManager({ hasImage: false })

    await user.click(screen.getByText(M.imagemGerar))

    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/image/generate'))).toBe(true))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(M.imagemPreviewTitulo)).toBeInTheDocument()
    // O preview aparece (a imagem com o url devolvido).
    await waitFor(() => expect(within(dialog).getByRole('img')).toHaveAttribute('src', 'https://fake-blob.local/recipes/0.png'))
    // Nenhum select foi chamado ⇒ a face não mudou.
    expect(calls.some((c) => c.url.includes('/select'))).toBe(false)
  })

  it('#222 "Usar esta": POST .../images/[imageId]/select + router.refresh', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch((method, url) => {
      if (method === 'POST' && url.endsWith('/image/generate'))
        return { status: 200, body: { image: { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: true } } }
      if (method === 'POST' && url.endsWith(`/images/${IMG1}/select`)) return { status: 200, body: { id: RID } }
      return { status: 405 }
    })
    renderManager({ hasImage: false })

    await user.click(screen.getByText(M.imagemGerar))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByRole('img')).toBeInTheDocument())
    await user.click(within(dialog).getByText(M.imagemUsarEsta))

    await waitFor(() => expect(calls.some((c) => c.url.endsWith(`/images/${IMG1}/select`))).toBe(true))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('#222 "Gerar outra": 2ª geração, preview trocado, SEM select', async () => {
    const user = userEvent.setup()
    let n = 0
    const { calls } = mockFetch((method, url) => {
      if (method === 'POST' && url.endsWith('/image/generate')) {
        n++
        return { status: 200, body: { image: { id: n === 1 ? IMG1 : IMG2, url: `https://fake-blob.local/recipes/${n}.png`, aiGenerated: true } } }
      }
      return { status: 405 }
    })
    renderManager({ hasImage: false })

    await user.click(screen.getByText(M.imagemGerar))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByRole('img')).toHaveAttribute('src', 'https://fake-blob.local/recipes/1.png'))

    await user.click(within(dialog).getByText(M.imagemGerarOutra))

    await waitFor(() => expect(within(dialog).getByRole('img')).toHaveAttribute('src', 'https://fake-blob.local/recipes/2.png'))
    expect(calls.filter((c) => c.url.endsWith('/image/generate')).length).toBe(2)
    expect(calls.some((c) => c.url.includes('/select'))).toBe(false)
  })

  it('#222 DECISION 6: fechar após gerar SEM selecionar ⇒ router.refresh', async () => {
    const user = userEvent.setup()
    mockFetch((method, url) =>
      method === 'POST' && url.endsWith('/image/generate')
        ? { status: 200, body: { image: { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: true } } }
        : { status: 405 },
    )
    renderManager({ hasImage: false })

    await user.click(screen.getByText(M.imagemGerar))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByRole('img')).toBeInTheDocument())
    refresh.mockClear()

    // Fecha pelo botão de fechar do Sheet (aria-label = imagemFechar).
    await user.click(within(dialog).getByLabelText(M.imagemFechar))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('#222 cap 429 no modal: mostra o countdown e NÃO chama refresh', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 429, body: { error: 'limite_geracao', retryAfterMs: 3600000 } }))
    renderManager({ hasImage: false })

    await user.click(screen.getByText(M.imagemGerar))

    expect(await screen.findByText(M.imagemLimite.replace('{tempo}', '1h'))).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('#222 403 desligada no modal (corrida): mostra o aviso, sem refresh', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 403, body: { error: 'geracao_desabilitada' } }))
    renderManager({ hasImage: false })

    await user.click(screen.getByText(M.imagemGerar))

    expect(await screen.findByText(M.imagemGerarDesabilitada)).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  // ── #222: galeria ───────────────────────────────────────────────────────────────
  it('#222 galeria lista as imagens + selo IA na gerada', () => {
    const gallery: GalleryImage[] = [
      { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: true, selected: true },
      { id: IMG2, url: 'https://fake-blob.local/recipes/1.png', aiGenerated: false, selected: false },
    ]
    renderManager({ hasImage: true, gallery })
    expect(screen.getByText(M.imagemGaleria)).toBeInTheDocument()
    const imgs = screen.getAllByRole('img')
    expect(imgs.length).toBe(2)
    // O selo de IA aparece (na gerada) — pelo menos uma ocorrência.
    expect(screen.getAllByText(M.imagemSeloIa).length).toBeGreaterThanOrEqual(1)
    // A selecionada está marcada "Em uso".
    expect(screen.getByText(M.imagemSelecionada)).toBeInTheDocument()
  })

  it('#222 galeria vazia ⇒ mensagem de vazio', () => {
    renderManager({ hasImage: false, gallery: [] })
    expect(screen.getByText(M.imagemGaleriaVazia)).toBeInTheDocument()
  })

  it('#222 clicar num thumbnail NÃO-selecionado ⇒ POST select + refresh', async () => {
    const user = userEvent.setup()
    const gallery: GalleryImage[] = [
      { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: false, selected: true },
      { id: IMG2, url: 'https://fake-blob.local/recipes/1.png', aiGenerated: false, selected: false },
    ]
    const { calls } = mockFetch((method, url) =>
      method === 'POST' && url.endsWith(`/images/${IMG2}/select`) ? { status: 200, body: { id: RID } } : { status: 405 },
    )
    renderManager({ hasImage: true, gallery })

    // O thumbnail é um <button aria-pressed>; clica no não-selecionado (aria-pressed=false).
    const thumbs = screen.getAllByRole('button', { pressed: false })
    await user.click(thumbs[0])

    await waitFor(() => expect(calls.some((c) => c.url.endsWith(`/images/${IMG2}/select`))).toBe(true))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('#222 apagar uma imagem da galeria ⇒ DELETE + refresh', async () => {
    const user = userEvent.setup()
    const gallery: GalleryImage[] = [
      { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: false, selected: true },
      { id: IMG2, url: 'https://fake-blob.local/recipes/1.png', aiGenerated: false, selected: false },
    ]
    const { calls } = mockFetch((method, url) =>
      method === 'DELETE' && url.endsWith(`/images/${IMG2}`) ? { status: 200, body: { id: RID } } : { status: 405 },
    )
    renderManager({ hasImage: true, gallery })

    // Botões "Apagar"; o da selecionada está desabilitado ⇒ clica no habilitado (IMG2).
    const apagar = screen.getAllByText(M.imagemApagar).map((n) => n.closest('button')!).filter((b) => !b.disabled)
    await user.click(apagar[0])

    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/images/${IMG2}`))).toBe(true))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('#222 apagar 409 in_use ⇒ mensagem amigável, sem refresh', async () => {
    const user = userEvent.setup()
    const gallery: GalleryImage[] = [
      { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: false, selected: true },
      { id: IMG2, url: 'https://fake-blob.local/recipes/1.png', aiGenerated: false, selected: false },
    ]
    mockFetch(() => ({ status: 409, body: { error: 'in_use' } }))
    renderManager({ hasImage: true, gallery })

    const apagar = screen.getAllByText(M.imagemApagar).map((n) => n.closest('button')!).filter((b) => !b.disabled)
    await user.click(apagar[0])

    expect(await screen.findByText(M.imagemApagarEmUso)).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('durante o upload: o label mostra imagemEnviando', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 200, body: { id: RID } }))
    const d = deferred<Blob>()
    resizeImage.mockReturnValueOnce(d.promise) // trava o resize → fica 'enviando'
    renderManager({ hasImage: false })

    await user.upload(screen.getByLabelText(M.imagemAdicionar), pngFile())
    expect(await screen.findByText(M.imagemEnviando)).toBeInTheDocument()

    d.resolve(pngFile())
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })
})
