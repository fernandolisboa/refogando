import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Modelos de IA por tarefa (#63, ADR-0034). Teste de COMPONENTE jsdom (seam #54): `fetch` mockado no
 * shape REAL das rotas `GET/PUT /api/admin/config` e `GET /api/admin/models`. Cobre: três blocos com o
 * valor em uso, modelo fora da lista, opções que seguem as capacidades do modelo, ajuste por modelo ao
 * trocar o select, PUT só da tarefa, erros por chave (`ajuste_recusado` com o motivo, 500 genérico) e
 * erro de CARGA + retry.
 *
 * As asserções da RolesSection vivem em `roles-section.test.tsx` (#269 trocou o "cole o UUID" por
 * busca → selecionar → atribuir; o componente ficou grande demais pra dividir o arquivo).
 */

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { ConfigSection } from '@/components/admin/config-section'

type FetchResult = { ok: boolean; status: number; body: unknown } | { reject: true }

/** Router de fetch por (url, method) → resposta. Cada chave pode ter fila de respostas. */
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

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const A = ptBR.admin

const ALL = { effort: ['low', 'medium', 'high', 'xhigh', 'max'], adaptiveThinking: true }
// Opções como `GET /api/admin/models` devolve (o mais novo de cada família, com capacidades).
const MODELS_OK: FetchResult = {
  ok: true,
  status: 200,
  body: {
    models: [
      { id: 'claude-opus-5-5', displayName: 'Claude Opus 5.5', family: 'opus', capabilities: ALL },
      {
        id: 'claude-sonnet-5',
        displayName: 'Claude Sonnet 5',
        family: 'sonnet',
        capabilities: { effort: ['low', 'medium', 'high'], adaptiveThinking: false },
      },
      { id: 'claude-fable-5-1', displayName: 'Claude Fable 5.1', family: 'fable', capabilities: null },
    ],
  },
}

type Settings = { effort: string | null; thinking: string }
function aiTasks(over: Partial<Record<string, { model: string; byModel: Record<string, Settings> }>> = {}) {
  return {
    generation: { model: 'claude-opus-5-5', byModel: {} },
    translation: { model: 'claude-sonnet-5', byModel: {} },
    extraction: { model: 'claude-sonnet-5', byModel: {} },
    ...over,
  }
}
const CONFIG_OK = (tasks = aiTasks()): FetchResult => ({ ok: true, status: 200, body: { aiTasks: tasks } })

function renderConfig() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <ConfigSection />
    </LocaleProvider>,
  )
}

/** Os três selects (modelo, esforço, thinking) + o botão de um bloco, pelo título da tarefa. */
async function block(titulo: string) {
  const group = await screen.findByRole('group', { name: titulo })
  const [model, effort, thinking] = within(group).getAllByRole('combobox') as HTMLSelectElement[]
  return { group, model, effort, thinking, save: within(group).getByRole('button', { name: A.salvar }) }
}

const texts = (select: HTMLSelectElement) => [...select.options].map((o) => o.textContent)

describe('ConfigSection — modelos de IA por tarefa (ADR-0034)', () => {
  it('um bloco por tarefa, com o modelo em uso e o ajuste default de cada tarefa', async () => {
    mockFetch({ 'GET /api/admin/models': MODELS_OK, 'GET /api/admin/config': CONFIG_OK() })
    renderConfig()
    const gen = await block(A.tarefaGeracaoTitulo)
    expect(gen.model.value).toBe('claude-opus-5-5')
    expect(texts(gen.model)).toEqual(['Claude Opus 5.5', 'Claude Sonnet 5', 'Claude Fable 5.1'])
    expect(gen.effort.value).toBe('medium')
    expect(gen.thinking.value).toBe('default')

    const tr = await block(A.tarefaTraducaoTitulo)
    expect(tr.model.value).toBe('claude-sonnet-5')
    expect(tr.effort.value).toBe('')
    expect(tr.thinking.value).toBe('off')
    await block(A.tarefaExtracaoTitulo)
  })

  it('modelo em uso fora da lista aparece marcado (o select não mente sobre o que está em uso)', async () => {
    mockFetch({
      'GET /api/admin/models': MODELS_OK,
      'GET /api/admin/config': CONFIG_OK(aiTasks({ generation: { model: 'claude-opus-4-8', byModel: {} } })),
    })
    renderConfig()
    const gen = await block(A.tarefaGeracaoTitulo)
    expect(gen.model.value).toBe('claude-opus-4-8')
    expect(gen.model.options[0].textContent).toBe(`claude-opus-4-8 (${A.modeloForaDaLista})`)
    expect(gen.model.options).toHaveLength(4)
  })

  it('opções de esforço e thinking seguem as capacidades do modelo escolhido', async () => {
    mockFetch({ 'GET /api/admin/models': MODELS_OK, 'GET /api/admin/config': CONFIG_OK() })
    renderConfig()
    const tr = await block(A.tarefaTraducaoTitulo)
    // Sonnet (no dublê): só low/medium/high, sem thinking adaptativo.
    expect(texts(tr.effort)).toEqual([A.padraoDoModelo, A.esforcoLow, A.esforcoMedium, A.esforcoHigh])
    expect(texts(tr.thinking)).toEqual([A.padraoDoModelo, A.thinkingDesligado])

    const user = userEvent.setup()
    // Fable (sem capacidades conhecidas): oferece tudo; o servidor testa ao salvar.
    await user.selectOptions(tr.model, 'claude-fable-5-1')
    expect(tr.effort.options).toHaveLength(6)
    expect(texts(tr.thinking)).toEqual([A.padraoDoModelo, A.thinkingAdaptativo, A.thinkingDesligado])
  })

  it('trocar o modelo recupera o ajuste salvo para ele, senão o default da tarefa', async () => {
    mockFetch({
      'GET /api/admin/models': MODELS_OK,
      'GET /api/admin/config': CONFIG_OK(
        aiTasks({
          extraction: {
            model: 'claude-sonnet-5',
            byModel: { 'claude-opus-5-5': { effort: 'max', thinking: 'adaptive' } },
          },
        }),
      ),
    })
    const user = userEvent.setup()
    renderConfig()
    const ex = await block(A.tarefaExtracaoTitulo)
    await user.selectOptions(ex.model, 'claude-opus-5-5')
    expect(ex.effort.value).toBe('max')
    expect(ex.thinking.value).toBe('adaptive')
    await user.selectOptions(ex.model, 'claude-fable-5-1')
    expect(ex.effort.value).toBe('')
    expect(ex.thinking.value).toBe('off')
  })

  it('salvar manda SÓ a tarefa do bloco (modelo + ajuste) → status de sucesso no bloco', async () => {
    const fetchMock = mockFetch({
      'GET /api/admin/models': MODELS_OK,
      'GET /api/admin/config': CONFIG_OK(),
      'PUT /api/admin/config': CONFIG_OK(
        aiTasks({
          extraction: { model: 'claude-opus-5-5', byModel: { 'claude-opus-5-5': { effort: 'high', thinking: 'off' } } },
        }),
      ),
    })
    const user = userEvent.setup()
    renderConfig()
    const ex = await block(A.tarefaExtracaoTitulo)
    await user.selectOptions(ex.model, 'claude-opus-5-5')
    await user.selectOptions(ex.effort, 'high')
    await user.click(ex.save)

    const put = fetchMock.mock.calls.find((c) => (c[1]?.method ?? 'GET') === 'PUT')!
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({
      aiTasks: { extraction: { model: 'claude-opus-5-5', settings: { effort: 'high', thinking: 'off' } } },
    })
    expect(await within(ex.group).findByText(A.salvo)).toBeInTheDocument()
  })

  it('400 ajuste_recusado → mensagem específica + o motivo que a Anthropic deu', async () => {
    mockFetch({
      'GET /api/admin/models': MODELS_OK,
      'GET /api/admin/config': CONFIG_OK(),
      'PUT /api/admin/config': {
        ok: false,
        status: 400,
        body: { error: 'ajuste_recusado', task: 'generation', message: 'thinking.type.disabled is not supported' },
      },
    })
    const user = userEvent.setup()
    renderConfig()
    const gen = await block(A.tarefaGeracaoTitulo)
    await user.selectOptions(gen.thinking, 'off')
    await user.click(gen.save)
    const alert = await within(gen.group).findByRole('alert')
    expect(alert).toHaveTextContent(A.erroAjusteRecusado)
    expect(alert).toHaveTextContent('thinking.type.disabled is not supported')
  })

  it('400 modelo_invalido / ajuste_nao_suportado → mensagens próprias; 500 → GENÉRICA', async () => {
    const cases: Array<[FetchResult, string]> = [
      [{ ok: false, status: 400, body: { error: 'modelo_invalido' } }, A.erroModelo],
      [{ ok: false, status: 400, body: { error: 'ajuste_nao_suportado' } }, A.erroAjusteNaoSuportado],
      [{ ok: false, status: 500, body: { error: 'erro_interno' } }, A.erroGenerico],
    ]
    for (const [response, message] of cases) {
      mockFetch({ 'GET /api/admin/models': MODELS_OK, 'GET /api/admin/config': CONFIG_OK(), 'PUT /api/admin/config': response })
      const user = userEvent.setup()
      const { unmount } = renderConfig()
      const tr = await block(A.tarefaTraducaoTitulo)
      await user.click(tr.save)
      expect(await within(tr.group).findByRole('alert')).toHaveTextContent(message)
      unmount()
    }
  })

  it('erro de CARGA → alert + retry; retry → segundo GET ok exibe os blocos', async () => {
    mockFetch({
      'GET /api/admin/models': MODELS_OK,
      'GET /api/admin/config': [
        { ok: false, status: 500, body: { error: 'erro_interno' } },
        CONFIG_OK(aiTasks({ generation: { model: 'claude-sonnet-5', byModel: {} } })),
      ],
    })
    const user = userEvent.setup()
    renderConfig()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(ptBR.system.error)
    expect(screen.queryByRole('combobox')).toBeNull()

    await user.click(screen.getByRole('button', { name: ptBR.system.retry }))
    const gen = await block(A.tarefaGeracaoTitulo)
    expect(gen.model.value).toBe('claude-sonnet-5')
  })
})
