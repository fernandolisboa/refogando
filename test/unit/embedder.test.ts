import { describe, it, expect, vi, afterEach } from 'vitest'
import { RealEmbedder, EMBEDDING_MODEL } from '@/server/embedding/embedder'
import { EMBEDDING_DIMENSIONS } from '@/db/schema'

/**
 * Embedder REAL (Gemini `:embedContent`) — caminho de REDE com `fetch` mockado (a key vem de
 * `vi.stubEnv`). O caminho real é gate humano (sem key, lança ANTES da rede), então a suíte
 * semântica usa o FakeEmbedder; aqui provamos só o CONTRATO DO WIRE: `outputDimensionality`=1536,
 * `content.parts[].text`, header `x-goog-api-key`, e o `taskType` ENVIADO quando especificado /
 * OMITIDO quando ausente (legado). O par assimétrico (doc×query) é exercido em search-semantica.
 */

const KEY = 'gemini-test-key'
const embedder = new RealEmbedder()

function mockFetch(values: number[] = [1, 2, 3]) {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const impl = vi.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return { ok: true, status: 200, json: async () => ({ embedding: { values } }) } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { impl, calls }
}

function bodyOf(calls: { init: RequestInit | undefined }[]): Record<string, unknown> {
  return JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('RealEmbedder — contrato do wire (#119/#2)', () => {
  it('sem GEMINI_API_KEY → lança ANTES de tocar a rede', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('GOOGLE_AI_API_KEY', '')
    const { impl } = mockFetch()
    await expect(embedder.embed('feijoada')).rejects.toThrow()
    expect(impl).not.toHaveBeenCalled()
  })

  it('com taskType → envia outputDimensionality, content.parts[].text, header e taskType', async () => {
    vi.stubEnv('GEMINI_API_KEY', KEY)
    const { calls } = mockFetch(new Array(EMBEDDING_DIMENSIONS).fill(0.1))
    const out = await embedder.embed('feijoada', 'RETRIEVAL_QUERY')
    expect(out).toHaveLength(EMBEDDING_DIMENSIONS)

    expect(calls[0].url).toContain(`${EMBEDDING_MODEL}:embedContent`)
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers['x-goog-api-key']).toBe(KEY)
    const body = bodyOf(calls)
    expect(body.outputDimensionality).toBe(EMBEDDING_DIMENSIONS)
    expect(body.content).toEqual({ parts: [{ text: 'feijoada' }] })
    expect(body.taskType).toBe('RETRIEVAL_QUERY')
  })

  it('sem taskType → NÃO inclui a chave taskType (legado)', async () => {
    vi.stubEnv('GEMINI_API_KEY', KEY)
    const { calls } = mockFetch()
    await embedder.embed('bolo')
    expect('taskType' in bodyOf(calls)).toBe(false)
  })

  it('HTTP não-ok → lança (corpo do erro é server-only)', async () => {
    vi.stubEnv('GEMINI_API_KEY', KEY)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 422, text: async () => 'enum inválido' }) as Response),
    )
    await expect(embedder.embed('x', 'RETRIEVAL_DOCUMENT')).rejects.toThrow()
  })
})
