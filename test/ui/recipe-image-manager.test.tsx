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

// Fase 2 de billing (flag-off): o componente só monta pro DONO — a sessão está sempre presente.
// Default: usuário `free` logado (o cenário mais comum deste componente).
const authMock = vi.hoisted(() => ({
  session: { data: { user: { id: 'owner-1', plan: 'free' as string | undefined } }, isPending: false, error: null as unknown },
}))
vi.mock('@/lib/auth-client', () => ({
  useSession: () => authMock.session,
}))
function setPlan(plan: string | undefined) {
  authMock.session = { data: { user: { id: 'owner-1', plan } }, isPending: false, error: null }
}

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

function renderManager(
  opts: {
    hasImage?: boolean
    gallery?: GalleryImage[]
    aiGenEnabled?: boolean
    imageGenBlocked?: boolean
  } = {},
) {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <RecipeImageManager
        recipeId={RID}
        hasImage={opts.hasImage ?? false}
        gallery={opts.gallery ?? []}
        aiGenEnabled={opts.aiGenEnabled ?? true}
        imageGenBlocked={opts.imageGenBlocked ?? false}
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
  setPlan('free')
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

  // ── #226: restrição por-conta (o Curador bloqueou a geração-por-IA deste usuário) ─────────────
  it('#226 imageGenBlocked: esconde "Gerar com IA" + mostra a nota (role=status); upload permanece', () => {
    renderManager({ hasImage: false, imageGenBlocked: true })
    expect(screen.queryByText(M.imagemGerar)).not.toBeInTheDocument()
    const nota = screen.getByText(M.imagemGerarBloqueadaNota)
    expect(nota).toBeInTheDocument()
    expect(nota).toHaveAttribute('role', 'status')
    // O upload (a restrição é só da geração-por-IA) continua disponível.
    expect(screen.getByText(M.imagemAdicionar)).toBeInTheDocument()
  })

  it('#226 não-bloqueado (default): "Gerar com IA" aparece e não há nota de bloqueio', () => {
    renderManager({ hasImage: false })
    expect(screen.getByText(M.imagemGerar)).toBeInTheDocument()
    expect(screen.queryByText(M.imagemGerarBloqueadaNota)).not.toBeInTheDocument()
  })

  it('#226 defesa-em-profundidade: 403 geracao_bloqueada no modal surfa a mensagem própria (≠ desabilitada)', async () => {
    const user = userEvent.setup()
    // O botão fica escondido quando imageGenBlocked=true; aqui testamos a CORRIDA (bloquearam no meio):
    // o usuário não-bloqueado abre o modal e o servidor responde 403 geracao_bloqueada.
    mockFetch(() => ({ status: 403, body: { error: 'geracao_bloqueada' } }))
    renderManager({ hasImage: false })

    await user.click(screen.getByText(M.imagemGerar))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByText(M.imagemGerarAgora))

    expect(await screen.findByText(M.imagemGerarBloqueada)).toBeInTheDocument()
    // NÃO mostra a mensagem de "desabilitada" (config-global) — é um motivo distinto.
    expect(screen.queryByText(M.imagemGerarDesabilitada)).not.toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  // ── #265: abrir o modal NÃO gera (estado de repouso = galeria) ───────────────────
  it('#265 abrir o modal NÃO POSTa /image/generate (não queima cota só de abrir)', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch((method, url) =>
      method === 'POST' && url.endsWith('/image/generate')
        ? { status: 200, body: { image: { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: true } } }
        : { status: 405 },
    )
    renderManager({ hasImage: false })

    await user.click(screen.getByText(M.imagemGerar)) // abre o modal
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(M.imagemPreviewTitulo)).toBeInTheDocument()

    // Nenhuma geração na abertura — a rota não foi tocada.
    expect(calls.filter((c) => c.url.endsWith('/image/generate'))).toHaveLength(0)
  })

  it('#265 a 1ª geração só ocorre no clique explícito de "Gerar" do modal', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch((method, url) =>
      method === 'POST' && url.endsWith('/image/generate')
        ? { status: 200, body: { image: { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: true } } }
        : { status: 405 },
    )
    renderManager({ hasImage: false })

    await user.click(screen.getByText(M.imagemGerar))
    const dialog = await screen.findByRole('dialog')
    expect(calls.filter((c) => c.url.endsWith('/image/generate'))).toHaveLength(0)

    // Só o clique no "Gerar" DENTRO do modal dispara a geração.
    await user.click(within(dialog).getByText(M.imagemGerarAgora))

    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/image/generate')).length).toBe(1))
    await waitFor(() =>
      expect(within(dialog).getByRole('img')).toHaveAttribute('src', 'https://fake-blob.local/recipes/0.png'),
    )
  })

  it('#265 a galeria existente aparece DENTRO do modal ao abrir (estado de repouso)', async () => {
    const user = userEvent.setup()
    const gallery: GalleryImage[] = [
      { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: true, selected: true, moderated: false, editedFromId: null },
      { id: IMG2, url: 'https://fake-blob.local/recipes/1.png', aiGenerated: false, selected: false, moderated: false, editedFromId: null },
    ]
    // Nada deve ser chamado ao abrir; se algo POSTar, 405 (o teste falharia ao não achar a galeria).
    mockFetch(() => ({ status: 405 }))
    renderManager({ hasImage: true, gallery })

    await user.click(screen.getByText(M.imagemGerar))
    const dialog = await screen.findByRole('dialog')

    // As imagens da galeria aparecem dentro do dialog (não só na página atrás do overlay).
    const imgs = within(dialog).getAllByRole('img')
    expect(imgs.some((i) => i.getAttribute('src')?.endsWith('/0.png'))).toBe(true)
    expect(imgs.some((i) => i.getAttribute('src')?.endsWith('/1.png'))).toBe(true)
  })

  it('#265 erro de ação na PÁGINA não vaza pro modal: abrir limpa o galleryError', async () => {
    const user = userEvent.setup()
    const gallery: GalleryImage[] = [
      { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: false, selected: true, moderated: false, editedFromId: null },
      { id: IMG2, url: 'https://fake-blob.local/recipes/1.png', aiGenerated: false, selected: false, moderated: false, editedFromId: null },
    ]
    // Apagar dá 409 in_use ⇒ galleryError='emUso' na página.
    mockFetch(() => ({ status: 409, body: { error: 'in_use' } }))
    renderManager({ hasImage: true, gallery })

    // Dispara o apagar na página (thumbnail apagável) → mostra imagemApagarEmUso.
    const apagar = screen.getAllByText(M.imagemApagar).map((n) => n.closest('button')!).filter((b) => !b.disabled)
    await user.click(apagar[0])
    expect(await screen.findByText(M.imagemApagarEmUso)).toBeInTheDocument()

    // Abre o modal → o erro da página foi limpo (não vaza pro estado de repouso do modal).
    await user.click(screen.getByText(M.imagemGerar))
    await screen.findByRole('dialog')
    expect(screen.queryByText(M.imagemApagarEmUso)).not.toBeInTheDocument()
  })

  // ── #222: preview-modal ─────────────────────────────────────────────────────────
  it('#222 gerar (clique no modal) POSTa /image/generate; mostra o preview; a face NÃO muda (sem select)', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch((method, url) =>
      method === 'POST' && url.endsWith('/image/generate')
        ? { status: 200, body: { image: { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: true } } }
        : { status: 405 },
    )
    renderManager({ hasImage: false })

    await user.click(screen.getByText(M.imagemGerar))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(M.imagemPreviewTitulo)).toBeInTheDocument()
    await user.click(within(dialog).getByText(M.imagemGerarAgora))

    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/image/generate'))).toBe(true))
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
    await user.click(within(dialog).getByText(M.imagemGerarAgora))
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
    await user.click(within(dialog).getByText(M.imagemGerarAgora))
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
    await user.click(within(dialog).getByText(M.imagemGerarAgora))
    await waitFor(() => expect(within(dialog).getByRole('img')).toBeInTheDocument())
    refresh.mockClear()

    // Fecha pelo botão de fechar do Sheet (aria-label = imagemFechar).
    await user.click(within(dialog).getByLabelText(M.imagemFechar))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  // ── #223: refino ancorado (base read-only + campo de refino) ──────────────────────
  it('#223 a 1ª geração (clique em "Gerar") POSTa { content-type: json } SEM prompt (refino vazio)', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch((method, url) =>
      method === 'POST' && url.endsWith('/image/generate')
        ? { status: 200, body: { image: { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: true }, basePrompt: 'Prato: Feijoada.' } }
        : { status: 405 },
    )
    renderManager({ hasImage: false })

    await user.click(screen.getByText(M.imagemGerar))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByText(M.imagemGerarAgora))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/image/generate'))).toBe(true))
    const gen = calls.find((c) => c.url.endsWith('/image/generate'))!
    // Refino vazio na 1ª geração ⇒ corpo vazio (sem { prompt }). O servidor monta da receita.
    expect(gen.body ? JSON.parse(String(gen.body)) : {}).toEqual({})
  })

  it('#223 prompt-base escondido por padrão; o botão menos-destacado revela em read-only', async () => {
    const user = userEvent.setup()
    mockFetch((method, url) =>
      method === 'POST' && url.endsWith('/image/generate')
        ? { status: 200, body: { image: { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: true }, basePrompt: 'Prato: Feijoada com feijão preto.' } }
        : { status: 405 },
    )
    renderManager({ hasImage: false })

    await user.click(screen.getByText(M.imagemGerar))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByText(M.imagemGerarAgora))
    await waitFor(() => expect(within(dialog).getByRole('img')).toBeInTheDocument())

    // Por padrão o base NÃO aparece.
    expect(within(dialog).queryByText('Prato: Feijoada com feijão preto.')).not.toBeInTheDocument()

    // O botão menos-destacado revela o base read-only.
    await user.click(within(dialog).getByText(M.imagemRefinar))
    expect(within(dialog).getByText('Prato: Feijoada com feijão preto.')).toBeInTheDocument()
  })

  it('#223 o base revelado é READ-ONLY (não um campo editável que posta)', async () => {
    const user = userEvent.setup()
    mockFetch((method, url) =>
      method === 'POST' && url.endsWith('/image/generate')
        ? { status: 200, body: { image: { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: true }, basePrompt: 'Prato: Feijoada.' } }
        : { status: 405 },
    )
    renderManager({ hasImage: false })

    await user.click(screen.getByText(M.imagemGerar))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByText(M.imagemGerarAgora))
    await waitFor(() => expect(within(dialog).getByRole('img')).toBeInTheDocument())
    await user.click(within(dialog).getByText(M.imagemRefinar))

    // O base aparece como texto read-only (um <output>), NÃO como textbox editável.
    const baseNode = within(dialog).getByText('Prato: Feijoada.')
    expect(baseNode.tagName.toLowerCase()).not.toBe('textarea')
    expect(baseNode.tagName.toLowerCase()).not.toBe('input')
  })

  it('#223 typing um refino + "Gerar outra" POSTa { prompt: <refino> }', async () => {
    const user = userEvent.setup()
    let n = 0
    const { calls } = mockFetch((method, url) => {
      if (method === 'POST' && url.endsWith('/image/generate')) {
        n++
        return { status: 200, body: { image: { id: n === 1 ? IMG1 : IMG2, url: `https://fake-blob.local/recipes/${n}.png`, aiGenerated: true }, basePrompt: 'Prato: Feijoada.' } }
      }
      return { status: 405 }
    })
    renderManager({ hasImage: false })

    await user.click(screen.getByText(M.imagemGerar))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByText(M.imagemGerarAgora))
    await waitFor(() => expect(within(dialog).getByRole('img')).toHaveAttribute('src', 'https://fake-blob.local/recipes/1.png'))

    // Revela o painel de refino e digita.
    await user.click(within(dialog).getByText(M.imagemRefinar))
    const refino = within(dialog).getByLabelText(M.imagemPromptRotulo)
    await user.type(refino, 'em aquarela')
    await user.click(within(dialog).getByText(M.imagemGerarOutra))

    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/image/generate')).length).toBe(2))
    const second = calls.filter((c) => c.url.endsWith('/image/generate'))[1]
    expect(JSON.parse(String(second.body))).toEqual({ prompt: 'em aquarela' })
  })

  it('#223 o campo de refino respeita o cap de 200 chars (maxLength)', async () => {
    const user = userEvent.setup()
    mockFetch((method, url) =>
      method === 'POST' && url.endsWith('/image/generate')
        ? { status: 200, body: { image: { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: true }, basePrompt: 'Prato: Feijoada.' } }
        : { status: 405 },
    )
    renderManager({ hasImage: false })

    await user.click(screen.getByText(M.imagemGerar))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByText(M.imagemGerarAgora))
    await waitFor(() => expect(within(dialog).getByRole('img')).toBeInTheDocument())
    await user.click(within(dialog).getByText(M.imagemRefinar))

    const refino = within(dialog).getByLabelText(M.imagemPromptRotulo) as HTMLTextAreaElement | HTMLInputElement
    expect(Number(refino.maxLength)).toBe(200)
  })

  it('#223 o refino RESETA ao fechar o modal: reabrir começa vazio e a geração ao reabrir POSTa {}', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch((method, url) =>
      method === 'POST' && url.endsWith('/image/generate')
        ? { status: 200, body: { image: { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: true }, basePrompt: 'Prato: Feijoada.' } }
        : { status: 405 },
    )
    renderManager({ hasImage: false })

    // 1ª sessão: abre, gera, revela o painel, digita um refino.
    await user.click(screen.getByText(M.imagemGerar))
    const dialog1 = await screen.findByRole('dialog')
    await user.click(within(dialog1).getByText(M.imagemGerarAgora))
    await waitFor(() => expect(within(dialog1).getByRole('img')).toBeInTheDocument())
    await user.click(within(dialog1).getByText(M.imagemRefinar))
    await user.type(within(dialog1).getByLabelText(M.imagemPromptRotulo), 'em aquarela')
    expect((within(dialog1).getByLabelText(M.imagemPromptRotulo) as HTMLTextAreaElement).value).toBe('em aquarela')

    // Fecha o modal (o refino deve ser descartado — não pode vazar pra próxima sessão/receita).
    await user.click(within(dialog1).getByLabelText(M.imagemFechar))
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).not.toBeInTheDocument())

    const genCallsBeforeReopen = calls.filter((c) => c.url.endsWith('/image/generate')).length

    // Reabre e gera de novo: deve POSTar {} (refino zerado), NÃO { prompt: 'em aquarela' }.
    await user.click(screen.getByText(M.imagemGerar))
    const dialog2 = await screen.findByRole('dialog')
    await user.click(within(dialog2).getByText(M.imagemGerarAgora))
    await waitFor(() => expect(within(dialog2).getByRole('img')).toBeInTheDocument())
    const reopenGen = calls.filter((c) => c.url.endsWith('/image/generate'))[genCallsBeforeReopen]
    expect(JSON.parse(String(reopenGen.body))).toEqual({})

    // E o campo de refino, ao revelar de novo, está vazio.
    await user.click(within(dialog2).getByText(M.imagemRefinar))
    expect((within(dialog2).getByLabelText(M.imagemPromptRotulo) as HTMLTextAreaElement).value).toBe('')
  })

  it('#222 cap 429 no modal: mostra o countdown e NÃO chama refresh', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 429, body: { error: 'limite_geracao', retryAfterMs: 3600000 } }))
    renderManager({ hasImage: false })

    await user.click(screen.getByText(M.imagemGerar))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByText(M.imagemGerarAgora))

    expect(await screen.findByText(M.imagemLimite.replace('{tempo}', '1h'))).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('Fase 2 (flag-off): cap 429 + usuário free ⇒ cartão de upsell JUNTO do countdown, com CTA estático pra /pt-BR/plano', async () => {
    const user = userEvent.setup()
    setPlan('free')
    mockFetch(() => ({ status: 429, body: { error: 'limite_geracao', retryAfterMs: 3600000 } }))
    renderManager({ hasImage: false })

    await user.click(screen.getByText(M.imagemGerar))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByText(M.imagemGerarAgora))

    expect(await screen.findByText(ptBR.upsell.titulo)).toBeInTheDocument()
    const cta = screen.getByRole('link', { name: ptBR.upsell.cta })
    expect(cta).toHaveAttribute('href', '/pt-BR/plano')
  })

  it('Fase 2 (flag-off): cap 429 + usuário pro ⇒ SEM cartão de upsell (já tem o teto maior)', async () => {
    const user = userEvent.setup()
    setPlan('pro')
    mockFetch(() => ({ status: 429, body: { error: 'limite_geracao', retryAfterMs: 3600000 } }))
    renderManager({ hasImage: false })

    await user.click(screen.getByText(M.imagemGerar))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByText(M.imagemGerarAgora))

    expect(await screen.findByText(M.imagemLimite.replace('{tempo}', '1h'))).toBeInTheDocument()
    expect(screen.queryByText(ptBR.upsell.titulo)).not.toBeInTheDocument()
  })

  it('#222 403 desligada no modal (corrida): mostra o aviso, sem refresh', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 403, body: { error: 'geracao_desabilitada' } }))
    renderManager({ hasImage: false })

    await user.click(screen.getByText(M.imagemGerar))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByText(M.imagemGerarAgora))

    expect(await screen.findByText(M.imagemGerarDesabilitada)).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('#222 DECISION 6 negativo: abrir → 429 (nenhuma geração) → fechar NÃO chama refresh', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 429, body: { error: 'limite_geracao', retryAfterMs: 3600000 } }))
    renderManager({ hasImage: false })

    await user.click(screen.getByText(M.imagemGerar))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByText(M.imagemGerarAgora))
    // A geração estourou (429) ⇒ generatedThisSession ficou false; o preview nunca apareceu.
    expect(await screen.findByText(M.imagemLimite.replace('{tempo}', '1h'))).toBeInTheDocument()
    refresh.mockClear()

    await user.click(within(dialog).getByLabelText(M.imagemFechar))

    // Nada foi gerado ⇒ fechar NÃO deve relê a página (não há previews a refletir).
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).not.toBeInTheDocument())
    expect(refresh).not.toHaveBeenCalled()
  })

  // ── #222: galeria ───────────────────────────────────────────────────────────────
  it('#222 galeria lista as imagens + selo IA na gerada', () => {
    const gallery: GalleryImage[] = [
      { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: true, selected: true, moderated: false, editedFromId: null },
      { id: IMG2, url: 'https://fake-blob.local/recipes/1.png', aiGenerated: false, selected: false, moderated: false, editedFromId: null },
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
      { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: false, selected: true, moderated: false, editedFromId: null },
      { id: IMG2, url: 'https://fake-blob.local/recipes/1.png', aiGenerated: false, selected: false, moderated: false, editedFromId: null },
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
      { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: false, selected: true, moderated: false, editedFromId: null },
      { id: IMG2, url: 'https://fake-blob.local/recipes/1.png', aiGenerated: false, selected: false, moderated: false, editedFromId: null },
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
      { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: false, selected: true, moderated: false, editedFromId: null },
      { id: IMG2, url: 'https://fake-blob.local/recipes/1.png', aiGenerated: false, selected: false, moderated: false, editedFromId: null },
    ]
    mockFetch(() => ({ status: 409, body: { error: 'in_use' } }))
    renderManager({ hasImage: true, gallery })

    const apagar = screen.getAllByText(M.imagemApagar).map((n) => n.closest('button')!).filter((b) => !b.disabled)
    await user.click(apagar[0])

    expect(await screen.findByText(M.imagemApagarEmUso)).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  // ── #225: moderação × galeria ─────────────────────────────────────────────────────
  it('#225 imagem moderada na galeria: marca "removida" + desabilita selecionar', () => {
    const gallery: GalleryImage[] = [
      { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: false, selected: false, moderated: true, editedFromId: null },
      { id: IMG2, url: 'https://fake-blob.local/recipes/1.png', aiGenerated: false, selected: false, moderated: false, editedFromId: null },
    ]
    renderManager({ hasImage: true, gallery })

    // O marcador "removida" aparece (pelo menos uma vez, na moderada).
    expect(screen.getAllByText(M.imagemRemovida).length).toBeGreaterThanOrEqual(1)

    // O thumbnail da moderada (IMG1) está desabilitado — não dá pra selecioná-la.
    const moderadaImg = screen.getAllByRole('img').find((n) => n.getAttribute('src')?.endsWith('/0.png'))!
    const moderadaBtn = moderadaImg.closest('button') as HTMLButtonElement
    expect(moderadaBtn.disabled).toBe(true)
    // A não-moderada (IMG2) segue selecionável.
    const limpaImg = screen.getAllByRole('img').find((n) => n.getAttribute('src')?.endsWith('/1.png'))!
    const limpaBtn = limpaImg.closest('button') as HTMLButtonElement
    expect(limpaBtn.disabled).toBe(false)
  })

  it('#225 selecionar uma moderada (via servidor) ⇒ 409 imagem_moderada surface mensagem amigável, sem refresh', async () => {
    const user = userEvent.setup()
    // A moderada está desabilitada por afordância; clicamos numa LIMPA cuja rota responde 409
    // (o servidor é a verdade; a UI mapeia 409 imagem_moderada → mensagem amigável).
    const gallery: GalleryImage[] = [
      { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: false, selected: true, moderated: false, editedFromId: null },
      { id: IMG2, url: 'https://fake-blob.local/recipes/1.png', aiGenerated: false, selected: false, moderated: false, editedFromId: null },
    ]
    mockFetch(() => ({ status: 409, body: { error: 'imagem_moderada' } }))
    renderManager({ hasImage: true, gallery })

    const thumbs = screen.getAllByRole('button', { pressed: false })
    await user.click(thumbs[0])

    expect(await screen.findByText(M.imagemModeradaNaoSelecionavel)).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('#225 nudge (US21): a face SELECIONADA está moderada ⇒ aviso de escolher outra (role=status)', () => {
    const gallery: GalleryImage[] = [
      { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: false, selected: true, moderated: true, editedFromId: null },
      { id: IMG2, url: 'https://fake-blob.local/recipes/1.png', aiGenerated: false, selected: false, moderated: false, editedFromId: null },
    ]
    renderManager({ hasImage: true, gallery })
    expect(screen.getByText(M.imagemSelecionadaModerada)).toBeInTheDocument()
  })

  it('#225 sem face moderada ⇒ nenhum nudge de moderação', () => {
    const gallery: GalleryImage[] = [
      { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: false, selected: true, moderated: false, editedFromId: null },
    ]
    renderManager({ hasImage: true, gallery })
    expect(screen.queryByText(M.imagemSelecionadaModerada)).not.toBeInTheDocument()
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

describe('RecipeImageManager — image-to-image (editar a partir de outra) (#285)', () => {
  const EDIT_BODY = {
    image: { id: '44444444-4444-4444-4444-444444444444', url: 'https://fake-blob.local/recipes/edit.png', aiGenerated: true, editedFromId: IMG1 },
    basePrompt: 'Prato: Bolo.',
  }

  it('#285 "Editar a partir desta" (galeria da página) abre o modal em modo edição e POSTa { sourceImageId }', async () => {
    const user = userEvent.setup()
    const gallery: GalleryImage[] = [
      { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: true, selected: true, moderated: false, editedFromId: null },
      { id: IMG2, url: 'https://fake-blob.local/recipes/1.png', aiGenerated: false, selected: false, moderated: false, editedFromId: null },
    ]
    const { calls } = mockFetch((method, url) =>
      method === 'POST' && url.endsWith('/image/generate') ? { status: 200, body: EDIT_BODY } : { status: 405 },
    )
    renderManager({ hasImage: true, gallery })

    // Clica "Editar a partir desta" no 1º thumbnail (página; modal fechado) → abre o modal em modo edição.
    await user.click(screen.getAllByText(M.imagemEditarDesta)[0])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(M.imagemEditandoDesta)).toBeInTheDocument()

    // Sem instrução, "Gerar" está DESABILITADO (edição exige refino).
    const gerar = within(dialog).getByText(M.imagemGerarAgora).closest('button') as HTMLButtonElement
    expect(gerar.disabled).toBe(true)

    // Digita a instrução e gera.
    await user.type(within(dialog).getByLabelText(M.imagemPromptRotulo), 'deixa mais clara')
    await user.click(within(dialog).getByText(M.imagemGerarAgora))

    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/image/generate'))).toBe(true))
    const gen = calls.find((c) => c.url.endsWith('/image/generate'))!
    expect(JSON.parse(String(gen.body))).toEqual({ prompt: 'deixa mais clara', sourceImageId: IMG1 })
    // O preview mostra o selo "Editada com IA".
    await waitFor(() => expect(within(dialog).getByText(M.imagemSeloIaEditada)).toBeInTheDocument())
  })

  it('#285 thumbnail editado mostra "editada com IA"; o gerado-do-zero mostra "gerada por IA"', () => {
    const gallery: GalleryImage[] = [
      { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: true, selected: false, moderated: false, editedFromId: null },
      { id: IMG2, url: 'https://fake-blob.local/recipes/1.png', aiGenerated: true, selected: false, moderated: false, editedFromId: IMG1 },
    ]
    renderManager({ hasImage: true, gallery })
    expect(screen.getByText(M.imagemSeloIaEditada)).toBeInTheDocument()
    expect(screen.getByText(M.imagemSeloIa)).toBeInTheDocument()
  })

  it('#285 "Cancelar edição" sai do modo edição (o banner some)', async () => {
    const user = userEvent.setup()
    const gallery: GalleryImage[] = [
      { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: true, selected: false, moderated: false, editedFromId: null },
    ]
    mockFetch(() => ({ status: 405 }))
    renderManager({ hasImage: true, gallery })

    await user.click(screen.getAllByText(M.imagemEditarDesta)[0])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(M.imagemEditandoDesta)).toBeInTheDocument()

    await user.click(within(dialog).getByText(M.imagemCancelarEdicao))
    expect(within(dialog).queryByText(M.imagemEditandoDesta)).not.toBeInTheDocument()
  })

  it('#285 editar a MODERADA é permitido (botão habilitado) — vira fonte', async () => {
    const user = userEvent.setup()
    const gallery: GalleryImage[] = [
      { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: true, selected: false, moderated: true, editedFromId: null },
    ]
    mockFetch(() => ({ status: 405 }))
    renderManager({ hasImage: true, gallery })

    // A moderada tem o botão "Editar a partir desta" HABILITADO (só `busy` desabilita).
    const editar = screen.getByText(M.imagemEditarDesta).closest('button') as HTMLButtonElement
    expect(editar.disabled).toBe(false)
    await user.click(editar)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(M.imagemEditandoDesta)).toBeInTheDocument()
  })

  it('#285 from-scratch após cancelar edição (fechar) NÃO vaza sourceImageId', async () => {
    const user = userEvent.setup()
    const gallery: GalleryImage[] = [
      { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: true, selected: false, moderated: false, editedFromId: null },
    ]
    const { calls } = mockFetch((method, url) =>
      method === 'POST' && url.endsWith('/image/generate')
        ? { status: 200, body: { image: { id: IMG2, url: 'https://fake-blob.local/recipes/n.png', aiGenerated: true, editedFromId: null } } }
        : { status: 405 },
    )
    renderManager({ hasImage: true, gallery })

    // Entra em modo edição e FECHA o modal (cancela via close).
    await user.click(screen.getAllByText(M.imagemEditarDesta)[0])
    const dialog1 = await screen.findByRole('dialog')
    await user.click(within(dialog1).getByLabelText(M.imagemFechar))
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).not.toBeInTheDocument())

    // Abre o modal from-scratch ("Gerar com IA") e gera (refino vazio).
    await user.click(screen.getByText(M.imagemGerar))
    const dialog2 = await screen.findByRole('dialog')
    expect(within(dialog2).queryByText(M.imagemEditandoDesta)).not.toBeInTheDocument()
    await user.click(within(dialog2).getByText(M.imagemGerarAgora))

    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/image/generate'))).toBe(true))
    const gen = calls.find((c) => c.url.endsWith('/image/generate'))!
    expect(JSON.parse(String(gen.body))).toEqual({}) // SEM sourceImageId
  })

  it('#285 "Gerar outra" em modo edição mantém o sourceImageId (itera a edição)', async () => {
    const user = userEvent.setup()
    let n = 0
    const gallery: GalleryImage[] = [
      { id: IMG1, url: 'https://fake-blob.local/recipes/0.png', aiGenerated: true, selected: false, moderated: false, editedFromId: null },
    ]
    const { calls } = mockFetch((method, url) => {
      if (method === 'POST' && url.endsWith('/image/generate')) {
        n++
        return { status: 200, body: { image: { id: `v${n}`, url: `https://fake-blob.local/recipes/e${n}.png`, aiGenerated: true, editedFromId: IMG1 }, basePrompt: 'Prato: Bolo.' } }
      }
      return { status: 405 }
    })
    renderManager({ hasImage: true, gallery })

    await user.click(screen.getAllByText(M.imagemEditarDesta)[0])
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(M.imagemPromptRotulo), 'mais clara')
    await user.click(within(dialog).getByText(M.imagemGerarAgora))
    await waitFor(() => expect(within(dialog).getByRole('img')).toBeInTheDocument())

    // "Gerar outra" mantém a edição (sourceImageId) — o refino ainda está preenchido.
    await user.click(within(dialog).getByText(M.imagemGerarOutra))
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/image/generate')).length).toBe(2))
    const second = calls.filter((c) => c.url.endsWith('/image/generate'))[1]
    expect(JSON.parse(String(second.body))).toEqual({ prompt: 'mais clara', sourceImageId: IMG1 })
  })
})
