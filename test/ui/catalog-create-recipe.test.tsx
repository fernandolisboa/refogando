import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Criação estruturada de Receita de catálogo (#85). Teste de COMPONENTE jsdom (seam #54):
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

describe('CatalogRecipeForm (#85)', () => {
  it('renderiza o form com os campos essenciais', async () => {
    mockFetch({ 'GET /api/curate/promotion': promotionVazio })
    renderForm()

    expect(
      await screen.findByRole('heading', { name: M.criarReceitaTitulo }),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText(M.criarReceitaTituloPlaceholder)).toBeInTheDocument()
    // Select de idioma original com valor inicial pt-BR (label = locale.ptBR).
    expect(screen.getByDisplayValue(ptBR.locale.ptBR)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: M.criarReceitaEnviar })).toBeInTheDocument()
    // Ausência ancorada no texto antigo distintivo (o "em breve" da subseção info-only foi-se).
    expect(screen.queryByText(/próximo passo/i)).toBeNull()
  })

  it('submit envia POST com o shape correto (200 → sucesso) e reseta', async () => {
    const fetchMock = mockFetch({
      'GET /api/curate/promotion': promotionVazio,
      'POST /api/curate/recipes': { ok: true, status: 200, body: { id: 'rec-1' } },
    })
    const user = userEvent.setup()
    renderForm()

    await user.type(
      await screen.findByPlaceholderText(M.criarReceitaTituloPlaceholder),
      'Feijoada',
    )
    await user.type(
      screen.getByPlaceholderText(M.criarReceitaIngredientePlaceholder),
      'feijão preto',
    )
    await user.type(screen.getByPlaceholderText(M.criarReceitaQuantidadePlaceholder), '500')
    // Unidade do 1º ingrediente = g; cozinha = brasileira (por label acessível — "Nenhuma"
    // de Cozinha e Categoria colidem em display value).
    await user.selectOptions(screen.getByRole('combobox', { name: M.criarReceitaUnidade }), 'g')
    await user.selectOptions(screen.getByRole('combobox', { name: M.criarReceitaCozinha }), 'brasileira')

    await user.click(screen.getByRole('button', { name: M.criarReceitaEnviar }))

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
    // quantidade é STRING; sem strength/mode/briefing.
    expect(typeof body.ingredientes[0].quantidade).toBe('string')
    expect(body).not.toHaveProperty('mode')
    expect(body).not.toHaveProperty('briefing')
    expect(body.ingredientes[0]).not.toHaveProperty('strength')

    // Sucesso anunciado + form resetou (título de volta a vazio).
    expect(await screen.findByRole('status')).toHaveTextContent(M.criarReceitaSucesso)
    expect(screen.getByPlaceholderText(M.criarReceitaTituloPlaceholder)).toHaveValue('')
  })

  it('erro 400 mostra alerta neutro e mantém o que foi digitado', async () => {
    mockFetch({
      'GET /api/curate/promotion': promotionVazio,
      'POST /api/curate/recipes': { ok: false, status: 400, body: { error: 'dados_invalidos' } },
    })
    const user = userEvent.setup()
    renderForm()

    const titulo = await screen.findByPlaceholderText(M.criarReceitaTituloPlaceholder)
    await user.type(titulo, 'Feijoada')
    await user.click(screen.getByRole('button', { name: M.criarReceitaEnviar }))

    expect(await screen.findByRole('alert')).toHaveTextContent(M.criarReceitaErroDados)
    expect(titulo).toHaveValue('Feijoada') // não resetou em erro
  })

  it('erro de rede mostra alerta de conexão', async () => {
    mockFetch({
      'GET /api/curate/promotion': promotionVazio,
      'POST /api/curate/recipes': { reject: true },
    })
    const user = userEvent.setup()
    renderForm()

    await user.type(
      await screen.findByPlaceholderText(M.criarReceitaTituloPlaceholder),
      'Feijoada',
    )
    await user.click(screen.getByRole('button', { name: M.criarReceitaEnviar }))

    expect(await screen.findByRole('alert')).toHaveTextContent(M.criarReceitaErroConexao)
  })

  it('erro não-ok não-400 (403) mostra alerta genérico', async () => {
    mockFetch({
      'GET /api/curate/promotion': promotionVazio,
      'POST /api/curate/recipes': {
        ok: false,
        status: 403,
        body: { error: 'papel_insuficiente' },
      },
    })
    const user = userEvent.setup()
    renderForm()

    const titulo = await screen.findByPlaceholderText(M.criarReceitaTituloPlaceholder)
    await user.type(titulo, 'Feijoada')
    await user.click(screen.getByRole('button', { name: M.criarReceitaEnviar }))

    expect(await screen.findByRole('alert')).toHaveTextContent(M.criarReceitaErroGenerico)
    expect(titulo).toHaveValue('Feijoada') // mantém o digitado, igual ao 400
  })

  it('confirmação de sucesso some na 1ª interação do usuário com o form', async () => {
    mockFetch({
      'GET /api/curate/promotion': promotionVazio,
      'POST /api/curate/recipes': { ok: true, status: 200, body: { id: 'rec-1' } },
    })
    const user = userEvent.setup()
    renderForm()

    const titulo = await screen.findByPlaceholderText(M.criarReceitaTituloPlaceholder)
    await user.type(titulo, 'Feijoada')
    await user.click(screen.getByRole('button', { name: M.criarReceitaEnviar }))

    // Sucesso renderizado e foco levado à confirmação (junto do botão de submit).
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(M.criarReceitaSucesso)

    // Primeira interação após o sucesso (digitar no título) limpa a confirmação órfã.
    await user.type(titulo, 'x')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('validação leve: sem título não dispara POST', async () => {
    const fetchMock = mockFetch({ 'GET /api/curate/promotion': promotionVazio })
    const user = userEvent.setup()
    renderForm()

    await user.click(await screen.findByRole('button', { name: M.criarReceitaEnviar }))

    expect(await screen.findByRole('alert')).toHaveTextContent(M.criarReceitaErroTitulo)
    expect(postCall(fetchMock)).toBeUndefined() // nenhuma chamada POST (o GET do mount não conta)
  })
})
