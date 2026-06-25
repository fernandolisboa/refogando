import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Criação estruturada de Receita de catálogo (#85; #266 abre num DRAWER lateral direito — os testes
 * clicam no gatilho `criarReceitaBotao` via `openDrawer` e escopam em `within(dialog)`).
 * Teste de COMPONENTE jsdom (seam #54):
 * `fetch` mockado no shape REAL de `POST /api/curate/recipes` (sucesso = 200 `{ id }`; erro
 * = 400 `{ error:'dados_invalidos' }` / 403 / rede). Renderiza `CatalogCuration` (que monta
 * o form) p/ cobrir a integração "form na seção Curadoria"; o `GET /api/curate/promotion` do
 * mount fica SEMPRE mockado vazio (estado neutro). Sem next/navigation (trava "sem
 * router.refresh"); o form não usa next/link nem auth-client.
 *
 * Loading: não há caso afirmando o estado intermediário (botão "Criando…", aria-busy,
 * fieldset disabled) — capturá-lo exigiria um fetch deferido. Loading é garantido por
 * inspeção visual; o modelo admin-curadoria.test.tsx também não o testa.
 *
 * clearSuccess: há caso afirmando que a confirmação `role="status"` some na 1ª interação do
 * usuário após o sucesso (digitar no título). removeItem/removePasso também chamam
 * clearSuccess por uniformidade, mas esse caminho é inalcançável após o reset (o form volta a
 * 1 ingrediente/passo → botão Remover desabilitado; adicionar para reabilitar já limpa o
 * sucesso). Logo a defesa em removeItem/removePasso é belt-and-suspenders, não um bug ativo.
 */

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { CatalogCuration } from '@/components/admin/catalog-curation'

type FetchResult = { ok: boolean; status: number; body: unknown } | { reject: true }

function mockFetch(routes: Record<string, FetchResult | FetchResult[]>) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    const method = (args[1]?.method ?? 'GET').toUpperCase()
    const key = `${method} ${url}`
    const entry = routes[key]
    if (entry === undefined) throw new Error(`fetch não mockado: ${key}`)
    const r = Array.isArray(entry) ? (entry.length > 1 ? entry.shift()! : entry[0]) : entry
    if ('reject' in r) throw new TypeError('network down')
    return { ok: r.ok, status: r.status, json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

const M = ptBR.curadoria
const promotionVazio: FetchResult = { ok: true, status: 200, body: { promotion: [] } }

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderForm() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <CatalogCuration />
    </LocaleProvider>,
  )
}

/** Seleciona a chamada POST entre as do fetch mock (o mount dispara um GET de promotion). */
function postCall(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls.find((c) => (c[1]?.method ?? 'GET') === 'POST')
}

/** #266: o form agora vive num DRAWER — clica no gatilho e devolve o `dialog` aberto. */
async function openDrawer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: M.criarReceitaBotao }))
  return screen.findByRole('dialog')
}

/** Promise controlável (pra travar o POST no estado 'Criando…' e testar o dismiss bloqueado). */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('CatalogRecipeForm + drawer (#85/#266)', () => {
  it('#266 o form fica atrás do gatilho; clicar abre o drawer com os campos', async () => {
    mockFetch({ 'GET /api/curate/promotion': promotionVazio })
    const user = userEvent.setup()
    renderForm()

    // Antes de abrir: o gatilho existe; os campos do form NÃO estão no DOM (vivem no drawer).
    expect(await screen.findByRole('button', { name: M.criarReceitaBotao })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(M.criarReceitaTituloPlaceholder)).toBeNull()

    const dialog = await openDrawer(user)
    // O título único (SheetTitle) + os campos essenciais aparecem no drawer.
    expect(within(dialog).getByRole('heading', { name: M.criarReceitaTitulo })).toBeInTheDocument()
    expect(within(dialog).getByPlaceholderText(M.criarReceitaTituloPlaceholder)).toBeInTheDocument()
    expect(within(dialog).getByDisplayValue(ptBR.locale.ptBR)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: M.criarReceitaEnviar })).toBeInTheDocument()
  })

  it('submit envia POST com o shape correto (200 → sucesso) e reseta', async () => {
    const fetchMock = mockFetch({
      'GET /api/curate/promotion': promotionVazio,
      'POST /api/curate/recipes': { ok: true, status: 200, body: { id: 'rec-1' } },
    })
    const user = userEvent.setup()
    renderForm()
    const dialog = await openDrawer(user)

    await user.type(within(dialog).getByPlaceholderText(M.criarReceitaTituloPlaceholder), 'Feijoada')
    await user.type(within(dialog).getByPlaceholderText(M.criarReceitaIngredientePlaceholder), 'feijão preto')
    await user.type(within(dialog).getByPlaceholderText(M.criarReceitaQuantidadePlaceholder), '500')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: M.criarReceitaUnidade }), 'g')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: M.criarReceitaCozinha }), 'brasileira')

    await user.click(within(dialog).getByRole('button', { name: M.criarReceitaEnviar }))

    const post = postCall(fetchMock)!
    expect(String(post[0])).toBe('/api/curate/recipes')
    expect((post[1] as RequestInit).method).toBe('POST')
    const body = JSON.parse(String((post[1] as RequestInit).body))
    expect(body).toEqual(
      expect.objectContaining({
        originalLocale: 'pt-BR',
        titulo: 'Feijoada',
        restricoes: [],
        cozinha: 'brasileira',
        ingredientes: [{ rawText: 'feijão preto', quantidade: '500', unidade: 'g' }],
      }),
    )
    // quantidade é STRING; sem strength/mode/briefing — contrato do catálogo inalterado.
    expect(typeof body.ingredientes[0].quantidade).toBe('string')
    expect(body).not.toHaveProperty('mode')
    expect(body).not.toHaveProperty('briefing')
    expect(body.ingredientes[0]).not.toHaveProperty('strength')

    // Sucesso anunciado + form resetou (título de volta a vazio) — o drawer SEGUE aberto.
    expect(await within(dialog).findByRole('status')).toHaveTextContent(M.criarReceitaSucesso)
    expect(within(dialog).getByPlaceholderText(M.criarReceitaTituloPlaceholder)).toHaveValue('')
  })

  it('erro 400 mostra alerta neutro e mantém o que foi digitado', async () => {
    mockFetch({
      'GET /api/curate/promotion': promotionVazio,
      'POST /api/curate/recipes': { ok: false, status: 400, body: { error: 'dados_invalidos' } },
    })
    const user = userEvent.setup()
    renderForm()
    const dialog = await openDrawer(user)

    const titulo = within(dialog).getByPlaceholderText(M.criarReceitaTituloPlaceholder)
    await user.type(titulo, 'Feijoada')
    await user.click(within(dialog).getByRole('button', { name: M.criarReceitaEnviar }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(M.criarReceitaErroDados)
    expect(titulo).toHaveValue('Feijoada') // não resetou em erro
  })

  it('erro de rede mostra alerta de conexão', async () => {
    mockFetch({
      'GET /api/curate/promotion': promotionVazio,
      'POST /api/curate/recipes': { reject: true },
    })
    const user = userEvent.setup()
    renderForm()
    const dialog = await openDrawer(user)

    await user.type(within(dialog).getByPlaceholderText(M.criarReceitaTituloPlaceholder), 'Feijoada')
    await user.click(within(dialog).getByRole('button', { name: M.criarReceitaEnviar }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(M.criarReceitaErroConexao)
  })

  it('erro não-ok não-400 (403) mostra alerta genérico', async () => {
    mockFetch({
      'GET /api/curate/promotion': promotionVazio,
      'POST /api/curate/recipes': { ok: false, status: 403, body: { error: 'papel_insuficiente' } },
    })
    const user = userEvent.setup()
    renderForm()
    const dialog = await openDrawer(user)

    const titulo = within(dialog).getByPlaceholderText(M.criarReceitaTituloPlaceholder)
    await user.type(titulo, 'Feijoada')
    await user.click(within(dialog).getByRole('button', { name: M.criarReceitaEnviar }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(M.criarReceitaErroGenerico)
    expect(titulo).toHaveValue('Feijoada') // mantém o digitado, igual ao 400
  })

  it('confirmação de sucesso some na 1ª interação do usuário com o form', async () => {
    mockFetch({
      'GET /api/curate/promotion': promotionVazio,
      'POST /api/curate/recipes': { ok: true, status: 200, body: { id: 'rec-1' } },
    })
    const user = userEvent.setup()
    renderForm()
    const dialog = await openDrawer(user)

    const titulo = within(dialog).getByPlaceholderText(M.criarReceitaTituloPlaceholder)
    await user.type(titulo, 'Feijoada')
    await user.click(within(dialog).getByRole('button', { name: M.criarReceitaEnviar }))

    const status = await within(dialog).findByRole('status')
    expect(status).toHaveTextContent(M.criarReceitaSucesso)

    await user.type(titulo, 'x')
    expect(within(dialog).queryByRole('status')).toBeNull()
  })

  it('validação leve: sem título não dispara POST', async () => {
    const fetchMock = mockFetch({ 'GET /api/curate/promotion': promotionVazio })
    const user = userEvent.setup()
    renderForm()
    const dialog = await openDrawer(user)

    await user.click(within(dialog).getByRole('button', { name: M.criarReceitaEnviar }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(M.criarReceitaErroTitulo)
    expect(postCall(fetchMock)).toBeUndefined() // nenhuma chamada POST (o GET do mount não conta)
  })

  it('#266 dismiss BLOQUEADO durante o POST: Esc não fecha o drawer; 1 POST só', async () => {
    const d = deferred<FetchResult>()
    const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0])
      const method = (args[1]?.method ?? 'GET').toUpperCase()
      if (method === 'GET' && url.includes('/promotion')) {
        return { ok: true, status: 200, json: async () => ({ promotion: [] }) } as Response
      }
      if (method === 'POST' && url.includes('/recipes')) {
        const r = await d.promise // trava o POST no estado 'Criando…'
        if ('reject' in r) throw new TypeError('network down')
        return { ok: r.ok, status: r.status, json: async () => r.body } as Response
      }
      throw new Error(`fetch não mockado: ${method} ${url}`)
    })
    vi.stubGlobal('fetch', impl)
    const user = userEvent.setup()
    renderForm()
    const dialog = await openDrawer(user)

    await user.type(within(dialog).getByPlaceholderText(M.criarReceitaTituloPlaceholder), 'Feijoada')
    await user.click(within(dialog).getByRole('button', { name: M.criarReceitaEnviar }))

    // O POST está em voo (botão "Criando…"). Esc NÃO fecha o drawer (dismiss bloqueado).
    expect(await within(dialog).findByRole('button', { name: M.criarReceitaEnviando })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Libera a resposta → conclui DENTRO do mesmo drawer; nenhum 2º POST.
    d.resolve({ ok: true, status: 200, body: { id: 'rec-1' } })
    expect(await within(dialog).findByRole('status')).toHaveTextContent(M.criarReceitaSucesso)
    const posts = impl.mock.calls.filter((c) => (c[1]?.method ?? 'GET') === 'POST').length
    expect(posts).toBe(1)
  })

  it('#266 reabrir o drawer reseta o form (estado limpo entre aberturas)', async () => {
    mockFetch({ 'GET /api/curate/promotion': promotionVazio })
    const user = userEvent.setup()
    renderForm()

    // Abre, digita um rascunho, fecha (Esc — sem POST em voo, fecha normalmente).
    const dialog1 = await openDrawer(user)
    await user.type(within(dialog1).getByPlaceholderText(M.criarReceitaTituloPlaceholder), 'rascunho que some')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // Reabre: o título começa vazio (o Radix desmonta o conteúdo ao fechar ⇒ form fresco).
    const dialog2 = await openDrawer(user)
    expect(within(dialog2).getByPlaceholderText(M.criarReceitaTituloPlaceholder)).toHaveValue('')
  })
})
