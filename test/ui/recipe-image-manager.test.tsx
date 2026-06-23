import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Teste jsdom da gestão da Imagem da receita (#130). `useRouter` mockado (refresh espionado);
 * `resizeImage` mockado (jsdom não tem canvas); `fetch` mockado no shape de `/api/recipes/[id]/image`.
 * Asserções: label Adicionar/Trocar conforme hasImage; upload faz POST multipart + router.refresh;
 * tipo recusado mostra erro inline sem rede; remover faz DELETE + refresh.
 */

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
const resizeImage = vi.fn(async (f: File): Promise<Blob> => f)
// O componente chama resizeImage(file, { maxDim }); o 2º arg é ignorado no runtime (os asserts não
// checam args). Mantém o mock de 1 param (como o avatar-uploader.test) — sem var não-usada.
vi.mock('@/lib/image-resize', () => ({ resizeImage: (f: File) => resizeImage(f) }))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { RecipeImageManager } from '@/components/recipe/recipe-image-manager'

const M = ptBR.detalhe
const RID = '11111111-1111-1111-1111-111111111111'

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

function renderManager(hasImage: boolean) {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <RecipeImageManager recipeId={RID} hasImage={hasImage} />
    </LocaleProvider>,
  )
}
function pngFile(name = 'p.png', type = 'image/png'): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type })
}

/** Promise controlável (pra travar o controle no estado 'enviando' e inspecionar o label). */
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

describe('RecipeImageManager — gestão da foto do prato (#130)', () => {
  it('sem imagem: label "Adicionar foto", sem botão Remover', () => {
    renderManager(false)
    expect(screen.getByText(M.imagemAdicionar)).toBeInTheDocument()
    expect(screen.queryByText(M.imagemRemover)).not.toBeInTheDocument()
  })

  it('com imagem: label "Trocar foto" + botão Remover', () => {
    renderManager(true)
    expect(screen.getByText(M.imagemTrocar)).toBeInTheDocument()
    expect(screen.getByText(M.imagemRemover)).toBeInTheDocument()
  })

  it('#207 ordem das ações: Gerar com IA → Trocar/Adicionar foto → Remover', () => {
    renderManager(true)
    // O upload é um <label> dentro de Button asChild (não tem role=button), então comparamos
    // a posição no DOM dos próprios nós de texto — robusto independentemente do elemento.
    const gerar = screen.getByText(M.imagemGerar)
    const upload = screen.getByText(M.imagemTrocar)
    const remover = screen.getByText(M.imagemRemover)
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING
    expect(gerar.compareDocumentPosition(upload) & FOLLOWING).toBeTruthy()
    expect(upload.compareDocumentPosition(remover) & FOLLOWING).toBeTruthy()
  })

  it('#207 imagemGerar sem emoji ✨', () => {
    expect(M.imagemGerar).toBe('Gerar com IA')
    expect(M.imagemGerar).not.toContain('✨')
  })

  it('reviewSuggested (#131) + imagem ⇒ mostra o aviso de revisar a foto', () => {
    render(
      <LocaleProvider initialLocale="pt-BR">
        <RecipeImageManager recipeId={RID} hasImage reviewSuggested />
      </LocaleProvider>,
    )
    expect(screen.getByText(M.imagemRevisar)).toBeInTheDocument()
  })

  it('reviewSuggested SEM imagem ⇒ não mostra o aviso (nada a revisar)', () => {
    render(
      <LocaleProvider initialLocale="pt-BR">
        <RecipeImageManager recipeId={RID} hasImage={false} reviewSuggested />
      </LocaleProvider>,
    )
    expect(screen.queryByText(M.imagemRevisar)).not.toBeInTheDocument()
  })

  it('sem reviewSuggested ⇒ não mostra o aviso', () => {
    renderManager(true)
    expect(screen.queryByText(M.imagemRevisar)).not.toBeInTheDocument()
  })

  it('upload válido: POST multipart para /api/recipes/[id]/image + router.refresh', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch((method) => (method === 'POST' ? { status: 200, body: { id: RID } } : { status: 405 }))
    renderManager(false)

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
    renderManager(false)
    // fireEvent (não userEvent.upload, que respeita accept): exercita o guard de tipo do client.
    fireEvent.change(screen.getByLabelText(M.imagemAdicionar), { target: { files: [pngFile('a.gif', 'image/gif')] } })

    expect(await screen.findByText(M.imagemTipoInvalido)).toBeInTheDocument()
    expect(impl).not.toHaveBeenCalled()
    expect(resizeImage).not.toHaveBeenCalled()
  })

  it('#132 gerar com IA (um-clique): POST /image/generate + router.refresh', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch((method, url) =>
      method === 'POST' && url.endsWith('/image/generate') ? { status: 200, body: { imageAiGenerated: true } } : { status: 405 },
    )
    renderManager(false)

    await user.click(screen.getByText(M.imagemGerar)) // o botão um-clique

    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/image/generate'))).toBe(true))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('#132 refino: abre o disclosure, digita o prompt e gera (POST com o prompt no body)', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch((method, url) =>
      method === 'POST' && url.endsWith('/image/generate') ? { status: 200, body: {} } : { status: 405 },
    )
    renderManager(false)

    await user.type(screen.getByLabelText(M.imagemPromptRotulo), 'prato neon futurista')
    await user.click(screen.getByText(M.imagemGerarComPrompt))

    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/image/generate'))).toBe(true))
    const post = calls.find((c) => c.url.endsWith('/image/generate'))!
    expect(JSON.parse(post.body as string)).toEqual({ prompt: 'prato neon futurista' })
  })

  it('#134 geração DESLIGADA (aiGenEnabled=false): esconde "Gerar com IA" e o refino; upload permanece', () => {
    render(
      <LocaleProvider initialLocale="pt-BR">
        <RecipeImageManager recipeId={RID} hasImage={false} aiGenEnabled={false} />
      </LocaleProvider>,
    )
    expect(screen.queryByText(M.imagemGerar)).not.toBeInTheDocument()
    expect(screen.queryByText(M.imagemRefinar)).not.toBeInTheDocument()
    expect(screen.queryByText(M.imagemGerarComPrompt)).not.toBeInTheDocument()
    // O upload da própria foto (#130) NÃO depende da geração por IA — continua disponível.
    expect(screen.getByText(M.imagemAdicionar)).toBeInTheDocument()
  })

  it('#134 geração ligada (default): "Gerar com IA" e o refino aparecem', () => {
    renderManager(false)
    expect(screen.getByText(M.imagemGerar)).toBeInTheDocument()
    expect(screen.getByText(M.imagemRefinar)).toBeInTheDocument()
  })

  it('#134 corrida 403 (desligaram no meio): mostra o aviso de geração desativada, sem refresh', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 403, body: { error: 'geracao_desabilitada' } }))
    renderManager(false)

    await user.click(screen.getByText(M.imagemGerar))

    expect(await screen.findByText(M.imagemGerarDesabilitada)).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('#132 teto estourado (429): mostra o countdown e NÃO chama refresh', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 429, body: { error: 'limite_geracao', retryAfterMs: 3600000 } }))
    renderManager(false)

    await user.click(screen.getAllByText(M.imagemGerar)[0])

    expect(await screen.findByText(M.imagemLimite.replace('{tempo}', '1h'))).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('remover: DELETE para a rota + router.refresh', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch((method) => (method === 'DELETE' ? { status: 200, body: { id: RID } } : { status: 405 }))
    renderManager(true)

    await user.click(screen.getByText(M.imagemRemover))

    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
    expect(calls.find((c) => c.method === 'DELETE')!.url).toBe(`/api/recipes/${RID}/image`)
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('falha do servidor no upload: mostra erro inline e NÃO chama refresh', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 500 }))
    renderManager(false)

    await user.upload(screen.getByLabelText(M.imagemAdicionar), pngFile())

    expect(await screen.findByText(M.imagemErro)).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('falha do servidor na remoção: mostra erro inline e NÃO chama refresh', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 500 }))
    renderManager(true)

    await user.click(screen.getByText(M.imagemRemover))

    expect(await screen.findByText(M.imagemErro)).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('resize acima do cap (2 MB): mostra imagemGrande e NÃO chama a rede', async () => {
    const user = userEvent.setup()
    const { impl } = mockFetch(() => ({ status: 200 }))
    resizeImage.mockResolvedValueOnce(new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/webp' }))
    renderManager(false)

    await user.upload(screen.getByLabelText(M.imagemAdicionar), pngFile())

    expect(await screen.findByText(M.imagemGrande)).toBeInTheDocument()
    expect(impl).not.toHaveBeenCalled()
  })

  it('durante o envio: o label mostra imagemEnviando', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 200, body: { id: RID } }))
    const d = deferred<Blob>()
    resizeImage.mockReturnValueOnce(d.promise) // trava o resize → fica 'enviando'
    renderManager(false)

    await user.upload(screen.getByLabelText(M.imagemAdicionar), pngFile())
    expect(await screen.findByText(M.imagemEnviando)).toBeInTheDocument()

    d.resolve(pngFile()) // libera; deixa o fluxo concluir sem warning de act
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })
})
