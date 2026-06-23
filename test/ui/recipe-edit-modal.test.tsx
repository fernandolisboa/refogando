import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { RecipeView } from '@/domain/recipe-read'

/**
 * Teste jsdom do MODAL centrado de edição IN-PLACE (#192/ADR-0021). O "Editar" abre o modal
 * (Sheet `side="center"`, Radix Dialog); editar e Salvar grava via `PATCH /api/recipes/[id]`
 * IN-PLACE (mesma Receita, sem criar derivada) e FECHA o modal; adicionar/remover ingrediente e
 * passo; Apagar com confirmação a partir do modal. `next/navigation` e LocaleProvider reais.
 *
 * Os polyfills de ponteiro/ResizeObserver do Radix vêm do test/ui/setup.ts (Dialog central).
 */

const refresh = vi.fn()
const push = vi.fn()
const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push, replace }),
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import type { Locale } from '@/i18n/locale'
import { RecipeEditModal } from '@/components/recipe/recipe-edit-modal'

const M = ptBR.edicaoPropria

function ownerView(over: Partial<RecipeView> = {}): RecipeView {
  return {
    id: 'r-1',
    name: 'Bolo simples',
    origin: 'ai_structured',
    schemaVersion: 1,
    body: { descricao: 'Doce caseiro', passos: ['Misture', 'Asse'], notas: null },
    facets: { cozinha: 'brasileira', categoria: 'sobremesa', tags: [] },
    porcoes: 4,
    dificuldade: 2,
    ingredients: [{ ordem: 0, quantidade: '2.000', unidade: 'xicara', rawText: 'farinha' }],
    translations: [],
    autoTranslationSignal: false,
    canManage: true,
    visibility: 'private',
    resultKind: 'success',
    ...over,
  }
}

type FetchResult = { status: number; body?: unknown }
function mockFetch(byMethod: (method: string) => FetchResult) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const init = args[1] as RequestInit | undefined
    const method = (init?.method ?? 'GET').toUpperCase()
    const r = byMethod(method)
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
    } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

function renderModal(view: RecipeView, locale: Locale = 'pt-BR') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <RecipeEditModal view={view} />
    </LocaleProvider>,
  )
}

async function openModal(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: ptBR.minhasCriacoes.editar }))
  return screen.findByRole('dialog')
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  refresh.mockClear()
  push.mockClear()
  replace.mockClear()
})

describe('RecipeEditModal (#192)', () => {
  it('fechado por padrão: nenhum dialog montado; "Editar" abre o modal centralizado com nome acessível', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 200, body: { ok: true } }))
    renderModal(ownerView())

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const dialog = await openModal(user)
    // Radix nomeia o painel pelo SheetTitle (aria-labelledby) — o contrato de a11y do modal.
    expect(dialog).toHaveAccessibleName(M.modalTitulo)
    // Prefilled a partir da view (conteúdo editável dentro do modal).
    expect(within(dialog).getByDisplayValue('Bolo simples')).toBeInTheDocument()
    expect(within(dialog).getByDisplayValue('Doce caseiro')).toBeInTheDocument()
  })

  it('ESC fecha o modal', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 200, body: { ok: true } }))
    renderModal(ownerView())
    await openModal(user)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('editar e Salvar grava IN-PLACE (PATCH na mesma receita, sem criar derivada) e fecha o modal', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(() => ({ status: 200, body: { ok: true } }))
    renderModal(ownerView({ visibility: 'private' }))
    const dialog = await openModal(user)

    const titulo = within(dialog).getByDisplayValue('Bolo simples')
    await user.clear(titulo)
    await user.type(titulo, 'Bolo de fubá')

    await user.click(within(dialog).getByRole('button', { name: M.editarPublicaConfirmar }))

    // PATCH IN-PLACE na MESMA URL/receita; NUNCA POST (que criaria uma derivada).
    const call = fetchMock.mock.calls[0]
    expect(String(call[0])).toBe('/api/recipes/r-1')
    expect((call[1] as RequestInit).method).toBe('PATCH')
    const sent = JSON.parse((call[1] as RequestInit).body as string)
    expect(sent.titulo).toBe('Bolo de fubá')
    expect(fetchMock.mock.calls.every((c) => (c[1] as RequestInit).method !== 'POST')).toBe(true)
    expect(refresh).toHaveBeenCalled()

    // Salvou ⇒ o modal fecha.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('adicionar e remover ingrediente funcionam dentro do modal', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 200, body: { ok: true } }))
    renderModal(ownerView())
    const dialog = await openModal(user)

    const before = within(dialog).getAllByRole('listitem')
    await user.click(within(dialog).getByRole('button', { name: ptBR.criar.adicionarIngrediente }))
    expect(within(dialog).getAllByRole('listitem').length).toBe(before.length + 1)

    // Remove o primeiro item (há ≥ 2 agora, então o remover não está desabilitado).
    const removers = within(dialog).getAllByRole('button', { name: /Remover ingrediente 1/ })
    await user.click(removers[0])
    expect(within(dialog).getAllByRole('listitem').length).toBe(before.length)
  })

  it('adicionar passo: o textarea de passos aceita novas linhas (passo adicional)', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(() => ({ status: 200, body: { ok: true } }))
    renderModal(ownerView())
    const dialog = await openModal(user)

    // O modo de preparo é um textarea (um passo por linha). Acrescenta um passo e salva.
    const passos = within(dialog).getByLabelText(ptBR.detalhe.passos)
    await user.click(passos)
    await user.keyboard('{End}')
    await user.type(passos, '\nSirva')

    await user.click(within(dialog).getByRole('button', { name: M.editarPublicaConfirmar }))
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(sent.passos).toEqual(['Misture', 'Asse', 'Sirva'])
  })

  it('Apagar com confirmação a partir do modal: confirma → DELETE e navega para /me/recipes', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch((method) =>
      method === 'DELETE' ? { status: 204 } : { status: 200, body: { ok: true } },
    )
    renderModal(ownerView())
    const dialog = await openModal(user)

    await user.click(within(dialog).getByRole('button', { name: ptBR.minhasCriacoes.apagar }))

    // O diálogo de confirmação de apagar abre (sobre o modal).
    const confirm = await screen.findByText(M.apagarAviso)
    expect(confirm).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: M.apagarConfirmar }))

    const del = fetchMock.mock.calls.find((c) => (c[1] as RequestInit).method === 'DELETE')
    expect(del).toBeDefined()
    expect(String(del![0])).toBe('/api/recipes/r-1')
    expect(push).toHaveBeenCalledWith('/me/recipes')
  })

  it('Cancelar fecha o modal sem nenhum PATCH', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(() => ({ status: 200, body: { ok: true } }))
    renderModal(ownerView())
    const dialog = await openModal(user)

    await user.click(within(dialog).getByRole('button', { name: M.editarPublicaCancelar }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // #197: regressão de PERDA-DE-DADOS no Escape. Com o confirm interno (apagar / editar-pública)
  // empilhado SOBRE o Sheet, o Escape deve fechar SÓ o confirm — o Sheet fica aberto e o rascunho
  // sobrevive. Antes do fix, o Radix (listener em capture) via o Escape primeiro e fechava o
  // Sheet inteiro, descartando todas as edições.
  it('#197 — Apagar abre o confirm; Escape fecha SÓ o confirm e o rascunho sobrevive (Sheet aberto)', async () => {
    const user = userEvent.setup()
    mockFetch((method) =>
      method === 'DELETE' ? { status: 204 } : { status: 200, body: { ok: true } },
    )
    renderModal(ownerView())
    const dialog = await openModal(user)

    // Rascunho: edita o título dentro do modal.
    const titulo = within(dialog).getByDisplayValue('Bolo simples')
    await user.clear(titulo)
    await user.type(titulo, 'Bolo de fubá')

    // Abre o confirm de apagar (empilha sobre o Sheet).
    await user.click(within(dialog).getByRole('button', { name: ptBR.minhasCriacoes.apagar }))
    expect(await screen.findByText(M.apagarAviso)).toBeInTheDocument()

    // Escape: fecha SÓ o confirm.
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText(M.apagarAviso)).not.toBeInTheDocument())

    // O Sheet continua aberto E o rascunho sobrevive (título ainda preenchido).
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Bolo de fubá')).toBeInTheDocument()
  })

  it('#197 — PÚBLICA: Salvar abre o confirm empilhado; Escape preserva o Sheet + rascunho e o PATCH só dispara após confirmar', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(() => ({ status: 200, body: { ok: true } }))
    renderModal(ownerView({ visibility: 'public' }))
    const dialog = await openModal(user)

    // Edita o título e tenta Salvar — na pública abre o confirm de editar-pública (sobre o Sheet).
    const titulo = within(dialog).getByDisplayValue('Bolo simples')
    await user.clear(titulo)
    await user.type(titulo, 'Bolo de fubá')
    await user.click(within(dialog).getByRole('button', { name: M.editarPublicaConfirmar }))

    // O confirm abriu e o PATCH AINDA não rodou (confirma antes de gravar a mudança pública).
    expect(await screen.findByText(M.editarPublicaAviso)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    // Escape: fecha SÓ o confirm; o Sheet + rascunho sobrevivem; nenhum PATCH disparou.
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText(M.editarPublicaAviso)).not.toBeInTheDocument())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Bolo de fubá')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    // Reabre o confirm e confirma → SÓ aí o PATCH IN-PLACE dispara.
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: M.editarPublicaConfirmar }),
    )
    const confirm = await screen.findByText(M.editarPublicaAviso)
    const confirmDialog = confirm.closest('[role="dialog"]') as HTMLElement
    await user.click(within(confirmDialog).getByRole('button', { name: M.editarPublicaConfirmar }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const call = fetchMock.mock.calls[0]
    expect(String(call[0])).toBe('/api/recipes/r-1')
    expect((call[1] as RequestInit).method).toBe('PATCH')
  })
})

/**
 * #195/ADR-0021 (decisão 4): Visibilidade DENTRO do modal como toggle RASCUNHO — clicar não chama o
 * servidor. No Salvar, a orquestração é conteúdo-primeiro: (1) PATCH; (2) SÓ se a visibilidade
 * mudou, POST publish/unpublish por request separado. web_imported/playful escondem o toggle.
 * Falha parcial (PATCH ok, publish falha) preserva o conteúdo + edição e mostra só o erro.
 */
const MV = ptBR.visibilidade

/** Fetch mockado que devolve por (método+URL); registra a ordem das chamadas (asserta a sequência). */
function mockFetchSeq(
  resolver: (method: string, url: string) => FetchResult,
): ReturnType<typeof vi.fn> {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    const init = args[1] as RequestInit | undefined
    const method = (init?.method ?? 'GET').toUpperCase()
    const r = resolver(method, url)
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body ?? {} } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

/** Liga o toggle "Tornar pública" (rascunho) dentro do modal. */
async function togglePublic(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.click(within(dialog).getByRole('checkbox', { name: new RegExp(MV.rascunhoTornarPublica) }))
}

describe('RecipeEditModal — Visibilidade no modal (#195)', () => {
  it('mostra o toggle de Visibilidade (rascunho); clicar NÃO dispara request', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchSeq(() => ({ status: 200, body: { ok: true } }))
    renderModal(ownerView({ visibility: 'private' }))
    const dialog = await openModal(user)

    const toggle = within(dialog).getByRole('checkbox', { name: new RegExp(MV.rascunhoTornarPublica) })
    expect(toggle).not.toBeChecked()
    await togglePublic(user, dialog)
    expect(toggle).toBeChecked()
    // Clicar no toggle NÃO chama o servidor (rascunho local).
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Salvar: PATCH do conteúdo e, SÓ se a visibilidade mudou, POST /publish — nessa ordem', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchSeq((method, url) =>
      url.endsWith('/publish') || url.endsWith('/unpublish')
        ? { status: 200, body: { visibility: 'public' } }
        : { status: 200, body: { ok: true } },
    )
    renderModal(ownerView({ visibility: 'private' }))
    const dialog = await openModal(user)

    await togglePublic(user, dialog)
    await user.click(within(dialog).getByRole('button', { name: M.editarPublicaConfirmar }))

    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(2))
    // Sequência: conteúdo primeiro (PATCH), depois publish.
    const [c1, c2] = fetchMock.mock.calls
    expect(String(c1[0])).toBe('/api/recipes/r-1')
    expect((c1[1] as RequestInit).method).toBe('PATCH')
    expect(String(c2[0])).toBe('/api/recipes/r-1/publish')
    expect((c2[1] as RequestInit).method).toBe('POST')
    // O PATCH não carrega `visibility` (fronteira owner-edit preservada).
    const sent = JSON.parse((c1[1] as RequestInit).body as string)
    expect(sent.visibility).toBeUndefined()
    // Salvou tudo ⇒ o modal fecha.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('Salvar SEM mudar a visibilidade: só PATCH, nenhum publish/unpublish', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchSeq(() => ({ status: 200, body: { ok: true } }))
    renderModal(ownerView({ visibility: 'private' }))
    const dialog = await openModal(user)

    // Edita só o título, NÃO mexe no toggle.
    const titulo = within(dialog).getByDisplayValue('Bolo simples')
    await user.clear(titulo)
    await user.type(titulo, 'Bolo de fubá')
    await user.click(within(dialog).getByRole('button', { name: M.editarPublicaConfirmar }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    // Exatamente UMA chamada: o PATCH. Sem publish/unpublish.
    expect(fetchMock.mock.calls.length).toBe(1)
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('PATCH')
  })

  it('pública → despublicar no Salvar: PATCH depois POST /unpublish', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchSeq((method, url) =>
      url.endsWith('/unpublish')
        ? { status: 200, body: { visibility: 'private' } }
        : { status: 200, body: { ok: true } },
    )
    renderModal(ownerView({ visibility: 'public' }))
    const dialog = await openModal(user)

    // Desmarca "Tornar pública" (estava marcada por ser pública).
    const toggle = within(dialog).getByRole('checkbox', { name: new RegExp(MV.rascunhoTornarPublica) })
    expect(toggle).toBeChecked()
    await user.click(toggle)

    // Pública ⇒ Salvar abre o confirm #277 antes de gravar; confirma.
    await user.click(within(dialog).getByRole('button', { name: M.editarPublicaConfirmar }))
    const confirm = await screen.findByText(M.editarPublicaAviso)
    const confirmDialog = confirm.closest('[role="dialog"]') as HTMLElement
    await user.click(within(confirmDialog).getByRole('button', { name: M.editarPublicaConfirmar }))

    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(2))
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('PATCH')
    expect(String(fetchMock.mock.calls[1][0])).toBe('/api/recipes/r-1/unpublish')
  })

  it('web_imported: o toggle de público NÃO aparece', async () => {
    const user = userEvent.setup()
    mockFetchSeq(() => ({ status: 200, body: { ok: true } }))
    renderModal(ownerView({ origin: 'web_imported' }))
    const dialog = await openModal(user)
    expect(
      within(dialog).queryByRole('checkbox', { name: new RegExp(MV.rascunhoTornarPublica) }),
    ).not.toBeInTheDocument()
  })

  it('playful: o toggle de público NÃO aparece', async () => {
    const user = userEvent.setup()
    mockFetchSeq(() => ({ status: 200, body: { ok: true } }))
    renderModal(ownerView({ resultKind: 'playful' }))
    const dialog = await openModal(user)
    expect(
      within(dialog).queryByRole('checkbox', { name: new RegExp(MV.rascunhoTornarPublica) }),
    ).not.toBeInTheDocument()
  })

  it('falha parcial: PATCH ok mas publish 422 → conteúdo salvo, erro só da visibilidade, edição preservada (modal aberto)', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchSeq((method, url) =>
      url.endsWith('/publish')
        ? { status: 422, body: { error: 'web_imported_nao_publicavel' } }
        : { status: 200, body: { ok: true } },
    )
    renderModal(ownerView({ visibility: 'private' }))
    const dialog = await openModal(user)

    const titulo = within(dialog).getByDisplayValue('Bolo simples')
    await user.clear(titulo)
    await user.type(titulo, 'Bolo de fubá')
    await togglePublic(user, dialog)
    await user.click(within(dialog).getByRole('button', { name: M.editarPublicaConfirmar }))

    // O conteúdo gravou (PATCH ok) e a page foi relida.
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    // PATCH + publish foram tentados, nessa ordem.
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('PATCH')
    // O PATCH de conteúdo NUNCA carrega visibilidade — esta vai só pelo publish/unpublish separado.
    const PATCH = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(PATCH.visibility).toBeUndefined()
    expect(String(fetchMock.mock.calls[1][0])).toBe('/api/recipes/r-1/publish')
    // Erro SÓ da visibilidade (parcial), e o modal continua aberto com a edição preservada.
    expect(await screen.findByText(MV.erroVisibilidadeParcial)).toBeInTheDocument()
    // O erro de SAVE (system.error) NÃO co-aparece: o conteúdo gravou; a falha é só de visibilidade.
    expect(screen.queryByText(ptBR.system.error)).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Bolo de fubá')).toBeInTheDocument()
  })
})
