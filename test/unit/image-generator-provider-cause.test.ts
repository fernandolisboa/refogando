import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImageProviderUnavailableError, RealGeminiImageGenerator } from '@/server/images/image-generator'
import { isConnectPhaseFailure } from '@/server/http/connect-phase'

/**
 * Regra ESTRITA do "não cobrado" do Gemini (ADR-0055) no `RealGeminiImageGenerator`, com o `fetch` dublado: só o
 * erro HTTP, a falha do `fetch` na fase de CONEXÃO (o pedido nunca saiu) e a chave ausente viram
 * `ImageProviderUnavailableError` (a reserva de cota volta). Qualquer outra falha do `fetch` (ECONNRESET,
 * "terminated": o corpo pode ter chegado ao Gemini) é um `Error` comum e a reserva fica cobrada.
 */

const fetchFailed = (code: string) =>
  new TypeError('fetch failed', { cause: Object.assign(new Error(`falha de socket ${code}`), { code }) })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function generateWith(fetchImpl: () => Promise<Response>): Promise<unknown> {
  vi.stubEnv('GEMINI_API_KEY', 'gemini-teste')
  vi.stubGlobal('fetch', vi.fn(fetchImpl))
  try {
    await new RealGeminiImageGenerator().generateDishImage({ prompt: 'bolo de fubá' })
    return null
  } catch (e) {
    return e
  }
}

describe('isConnectPhaseFailure', () => {
  it('só os códigos da fase de conexão, olhando a cadeia de cause; AggregateError exige todos', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']) {
      expect(isConnectPhaseFailure(fetchFailed(code))).toBe(true)
    }
    expect(isConnectPhaseFailure(fetchFailed('CERT_HAS_EXPIRED'))).toBe(true)
    for (const code of ['ECONNRESET', 'UND_ERR_SOCKET', 'EPIPE', 'ETIMEDOUT']) {
      expect(isConnectPhaseFailure(fetchFailed(code))).toBe(false)
    }
    expect(isConnectPhaseFailure(new TypeError('terminated'))).toBe(false)
    expect(isConnectPhaseFailure(new DOMException('aborted', 'AbortError'))).toBe(false)
    expect(isConnectPhaseFailure(undefined)).toBe(false)
    const refusedBoth = new AggregateError([
      Object.assign(new Error('v4'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('v6'), { code: 'ENETUNREACH' }),
    ])
    expect(isConnectPhaseFailure(new TypeError('fetch failed', { cause: refusedBoth }))).toBe(true)
    const mixed = new AggregateError([
      Object.assign(new Error('v4'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('v6'), { code: 'ECONNRESET' }),
    ])
    expect(isConnectPhaseFailure(new TypeError('fetch failed', { cause: mixed }))).toBe(false)
  })
})

describe('RealGeminiImageGenerator — ImageProviderUnavailableError só no provadamente não cobrado', () => {
  it('conexão recusada ou DNS ⇒ ImageProviderUnavailableError (com a falha em cause)', async () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND']) {
      const cause = fetchFailed(code)
      const err = await generateWith(() => Promise.reject(cause))
      expect(err).toBeInstanceOf(ImageProviderUnavailableError)
      expect((err as Error).cause).toBe(cause)
    }
  })

  it('ECONNRESET / "terminated" depois de conectar ⇒ Error comum (a reserva fica cobrada)', async () => {
    for (const cause of [fetchFailed('ECONNRESET'), new TypeError('terminated')]) {
      const err = await generateWith(() => Promise.reject(cause))
      expect(err).toBeInstanceOf(Error)
      expect(err).not.toBeInstanceOf(ImageProviderUnavailableError)
      expect((err as Error).cause).toBe(cause)
    }
  })

  it('HTTP de erro ⇒ ImageProviderUnavailableError', async () => {
    const err = await generateWith(async () => new Response('sobrecarga', { status: 503 }))
    expect(err).toBeInstanceOf(ImageProviderUnavailableError)
  })

  it('200 sem bytes ⇒ Error comum (pago)', async () => {
    const err = await generateWith(async () => Response.json({ candidates: [{ content: { parts: [] } }] }))
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(ImageProviderUnavailableError)
  })

  it('sem GEMINI_API_KEY ⇒ ImageProviderUnavailableError ANTES de tocar a rede', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('GOOGLE_AI_API_KEY', '')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(new RealGeminiImageGenerator().generateDishImage({ prompt: 'x' })).rejects.toBeInstanceOf(
      ImageProviderUnavailableError,
    )
    expect(fetch).not.toHaveBeenCalled()
  })
})
