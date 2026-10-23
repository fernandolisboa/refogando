import { describe, it, expect } from 'vitest'
import {
  ACCOUNT_EXPORT_FILENAME_PREFIX,
  accountExportFilename,
  exportablePromptStamp,
  jsonObjectChunks,
  type JsonObjectSection,
} from '@/domain/account-export'
import { PROMPT_VERSION, promptStampFor, type PromptStamp } from '@/domain/briefing'

/** Export LGPD da conta (#595) — o nome do arquivo, o carimbo do prompt sem texto de admin e o escritor em streaming. */
describe('accountExportFilename', () => {
  it('prefixo + data UTC + .json', () => {
    expect(accountExportFilename(new Date('2026-10-22T23:59:59Z'))).toBe('refogando-meus-dados-2026-10-22.json')
    expect(ACCOUNT_EXPORT_FILENAME_PREFIX).toBe('refogando-meus-dados')
  })

  it('a data é a do UTC, não a do fuso local (22h de Brasília já é o dia seguinte)', () => {
    expect(accountExportFilename(new Date('2026-10-22T22:00:00-03:00'))).toBe('refogando-meus-dados-2026-10-23.json')
    expect(accountExportFilename(new Date('2026-10-23T01:00:00-03:00'))).toBe('refogando-meus-dados-2026-10-23.json')
  })
})

describe('exportablePromptStamp', () => {
  it('só a versão, o nível, o nome da cozinha e os rótulos dos polos; nunca a nota curada nem a instrução', () => {
    const stamp = promptStampFor({
      nivelChef: 'avancado',
      vozCozinha: { nome: 'mineira', notaCurada: 'nota do Curador' },
      variacaoDivergente: { poloA: 'rápida', poloB: 'demorada', instrucao: 'texto do admin' },
    })
    const out = exportablePromptStamp(stamp)
    expect(out).toEqual({
      version: PROMPT_VERSION,
      axes: {
        nivelChef: 'avancado',
        vozCozinha: { nome: 'mineira' },
        variacaoDivergente: { poloA: 'rápida', poloB: 'demorada' },
      },
    })
    expect(JSON.stringify(out)).not.toMatch(/nota do Curador|texto do admin|notaCurada|instrucao/)
  })

  it('eixos neutros ficam vazios; sem carimbo (geração antiga) é null', () => {
    expect(exportablePromptStamp(promptStampFor())).toEqual({ version: PROMPT_VERSION, axes: {} })
    expect(exportablePromptStamp(null)).toBeNull()
    expect(exportablePromptStamp(undefined)).toBeNull()
  })

  it('jsonb fora da forma: só sai o que tem o tipo certo', () => {
    const odd = { version: 'x', axes: { nivelChef: 3, vozCozinha: { notaCurada: 'só a nota' }, extra: 'chave nova' } }
    expect(exportablePromptStamp(odd as unknown as PromptStamp)).toEqual({ version: null, axes: {} })
  })
})

async function* sectionsOf(entries: JsonObjectSection[]): AsyncGenerator<JsonObjectSection> {
  for (const entry of entries) yield entry
}

async function collect(entries: JsonObjectSection[]): Promise<{ text: string; chunks: number }> {
  let text = ''
  let chunks = 0
  for await (const chunk of jsonObjectChunks(sectionsOf(entries))) {
    text += chunk
    chunks += 1
  }
  return { text, chunks }
}

describe('jsonObjectChunks (o export em streaming)', () => {
  it('o texto é byte a byte o de JSON.stringify(objeto, null, 2), um pedaço por seção', async () => {
    const entries: JsonObjectSection[] = [
      ['format', 'refogando-account-export/v1'],
      ['exportedAt', new Date('2026-10-22T12:00:00Z')],
      ['account', { id: 'u-1', links: [{ tipo: 'site', url: 'https://x.test' }], bio: 'linha 1\nlinha 2 "aspas" é' }],
      ['vazioLista', []],
      ['vazioObjeto', {}],
      ['nulo', null],
      ['numero', 0.012345],
      ['booleano', false],
      ['aninhado', [{ a: [1, [2, { b: null }]], c: { d: [] } }]],
      ['ignorado', undefined],
      ['ultimo', 'fim'],
    ]
    const { text, chunks } = await collect(entries)
    expect(text).toBe(JSON.stringify(Object.fromEntries(entries), null, 2))
    // 10 seções com valor + o fechamento; a de valor `undefined` some, como no JSON.stringify.
    expect(chunks).toBe(11)
    expect(JSON.parse(text)).not.toHaveProperty('ignorado')
  })

  it('sem seção nenhuma: {} (o mesmo do JSON.stringify de um objeto vazio)', async () => {
    expect((await collect([])).text).toBe(JSON.stringify({}, null, 2))
  })

  it('uma seção só', async () => {
    const entries: JsonObjectSection[] = [['recipes', [{ id: 'r-1', passos: ['a', 'b'] }]]]
    expect((await collect(entries)).text).toBe(JSON.stringify(Object.fromEntries(entries), null, 2))
  })
})
