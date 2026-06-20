import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Teste jsdom do controle de avatar (#126). `useSession` mockado (sem Better Auth no jsdom);
 * `resizeImage` mockado (jsdom não tem canvas — a impl real nunca roda aqui, só validamos o
 * comportamento do controle); `fetch` mockado no shape de `/api/me/avatar`.
 *
 * Asserções: Visitante não vê nada; sem foto mostra iniciais + "Enviar foto"; com foto mostra <img>
 * + "Trocar/Remover"; upload válido faz POST multipart e reflete a nova URL + refetch; tipo recusado
 * mostra erro inline e NÃO chama a rede; remover faz DELETE e limpa.
 */

type SessionUser = { id: string; name?: string; email?: string; image?: string | null }
type SessionState = { data: { user: SessionUser } | null; error: unknown; isPending: boolean; refetch: () => Promise<void> }
let sessionState: SessionState
const refetch = vi.fn(async () => {})

vi.mock('@/lib/auth-client', () => ({
  useSession: () => sessionState,
}))
// resizeImage devolve o próprio arquivo (identidade) — o controle segue o fluxo real de upload.
const resizeImage = vi.fn(async (f: File): Promise<Blob> => f)
vi.mock('@/lib/image-resize', () => ({ resizeImage: (f: File) => resizeImage(f) }))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import type { Locale } from '@/i18n/locale'
import { AvatarUploader } from '@/components/profile/avatar-uploader'

const M = ptBR.perfil

function authed(over: Partial<SessionUser> = {}): SessionState {
  return { data: { user: { id: 'u-1', name: 'Ana Silva', email: 'ana@ex.com', ...over } }, error: null, isPending: false, refetch }
}
function guest(): SessionState {
  return { data: null, error: null, isPending: false, refetch }
}

type FetchResult = { status: number; body?: unknown }
/** Mock de fetch por método; captura as chamadas (método + body). */
function mockFetch(byMethod: (method: string, body: unknown) => FetchResult) {
  const calls: { method: string; url: string; body: unknown }[] = []
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    const init = args[1] as RequestInit | undefined
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ method, url, body: init?.body })
    const r = byMethod(method, init?.body)
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body ?? {} } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { impl, calls }
}

function renderUploader(locale: Locale = 'pt-BR') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <AvatarUploader />
    </LocaleProvider>,
  )
}

function pngFile(name = 'a.png', type = 'image/png'): File {
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
  refetch.mockClear()
  resizeImage.mockClear()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AvatarUploader — controle de avatar (#126)', () => {
  it('Visitante: não renderiza nada', () => {
    sessionState = guest()
    const { container } = renderUploader()
    expect(container).toBeEmptyDOMElement()
  })

  it('sem foto: mostra iniciais (fallback) e o botão "Enviar foto"', () => {
    sessionState = authed({ image: null })
    renderUploader()
    expect(screen.getByText('AS')).toBeInTheDocument() // iniciais de "Ana Silva"
    expect(screen.getByText(M.avatarEnviar)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByText(M.avatarRemover)).not.toBeInTheDocument()
  })

  it('com foto: mostra <img> e os botões "Trocar"/"Remover"', () => {
    sessionState = authed({ image: 'https://abc.public.blob.vercel-storage.com/avatars/x.webp' })
    renderUploader()
    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.src).toContain('vercel-storage.com')
    expect(screen.getByText(M.avatarTrocar)).toBeInTheDocument()
    expect(screen.getByText(M.avatarRemover)).toBeInTheDocument()
  })

  it('upload válido: POST multipart para /api/me/avatar, reflete a nova URL e chama refetch', async () => {
    const user = userEvent.setup()
    sessionState = authed({ image: null })
    const novaUrl = 'https://abc.public.blob.vercel-storage.com/avatars/novo.webp'
    const { calls } = mockFetch((method) => (method === 'POST' ? { status: 200, body: { image: novaUrl } } : { status: 405 }))
    renderUploader()

    const input = screen.getByLabelText(M.avatarEnviar)
    await user.upload(input, pngFile())

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.url).toBe('/api/me/avatar')
    expect(post.body).toBeInstanceOf(FormData)
    expect((post.body as FormData).get('file')).toBeInstanceOf(File)
    expect(resizeImage).toHaveBeenCalledOnce()

    // Reflete a nova foto e sincroniza a sessão (header).
    await waitFor(() => expect((screen.getByRole('img') as HTMLImageElement).src).toBe(novaUrl))
    expect(refetch).toHaveBeenCalled()
  })

  it('tipo recusado no client: mostra erro inline e NÃO chama a rede', async () => {
    sessionState = authed({ image: null })
    const { impl } = mockFetch(() => ({ status: 200 }))
    renderUploader()

    // fireEvent (não userEvent.upload, que respeita `accept` e dropa o gif): no browser real o
    // usuário pode forçar "todos os arquivos", então o guard de tipo no client é defesa de verdade.
    const input = screen.getByLabelText(M.avatarEnviar)
    fireEvent.change(input, { target: { files: [pngFile('a.gif', 'image/gif')] } })

    expect(await screen.findByText(M.avatarTipoInvalido)).toBeInTheDocument()
    expect(impl).not.toHaveBeenCalled()
    expect(resizeImage).not.toHaveBeenCalled()
  })

  it('falha do servidor (POST !ok): mostra avatarErro e NÃO troca a foto', async () => {
    const user = userEvent.setup()
    sessionState = authed({ image: null })
    mockFetch(() => ({ status: 500 }))
    renderUploader()

    await user.upload(screen.getByLabelText(M.avatarEnviar), pngFile())

    expect(await screen.findByText(M.avatarErro)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument() // segue sem foto (iniciais)
  })

  it('resize acima do cap (2 MB): mostra avatarGrande e NÃO chama a rede', async () => {
    const user = userEvent.setup()
    sessionState = authed({ image: null })
    const { impl } = mockFetch(() => ({ status: 200 }))
    // resizeImage devolve um blob grande demais → o guard de tamanho corta antes do fetch.
    resizeImage.mockResolvedValueOnce(new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/webp' }))
    renderUploader()

    await user.upload(screen.getByLabelText(M.avatarEnviar), pngFile())

    expect(await screen.findByText(M.avatarGrande)).toBeInTheDocument()
    expect(impl).not.toHaveBeenCalled()
  })

  it('durante o envio: o label mostra avatarEnviando', async () => {
    const user = userEvent.setup()
    sessionState = authed({ image: null })
    const novaUrl = 'https://abc.public.blob.vercel-storage.com/avatars/x.webp'
    mockFetch(() => ({ status: 200, body: { image: novaUrl } }))
    // Trava o resize pendente → o controle fica em 'enviando' até resolvermos.
    const d = deferred<Blob>()
    resizeImage.mockReturnValueOnce(d.promise)
    renderUploader()

    await user.upload(screen.getByLabelText(M.avatarEnviar), pngFile())
    expect(await screen.findByText(M.avatarEnviando)).toBeInTheDocument()

    d.resolve(pngFile()) // libera; deixa o fluxo concluir sem warning de act
    await waitFor(() => expect(refetch).toHaveBeenCalled())
  })

  it('remover: faz DELETE e limpa a foto (volta às iniciais)', async () => {
    const user = userEvent.setup()
    sessionState = authed({ image: 'https://abc.public.blob.vercel-storage.com/avatars/x.webp' })
    const { calls } = mockFetch((method) => (method === 'DELETE' ? { status: 200, body: { image: null } } : { status: 405 }))
    renderUploader()

    await user.click(screen.getByText(M.avatarRemover))

    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
    expect(calls.find((c) => c.method === 'DELETE')!.url).toBe('/api/me/avatar')
    await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument())
    expect(refetch).toHaveBeenCalled()
  })
})
