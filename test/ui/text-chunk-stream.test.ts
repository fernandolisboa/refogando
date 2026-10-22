/**
 * Corpo em streaming do export da conta (#595, `src/server/http/text-chunk-stream.ts`). Puro (só streams):
 * roda no projeto "ui", sem banco. O cliente que cancela no meio de uma seção não pode virar linha de erro
 * de servidor.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { textChunkStream } from '@/server/http/text-chunk-stream'

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Dá a vez a todas as microtarefas pendentes (o `pull` que acordou, o `return` enfileirado). */
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

/** Mesmo `onError` da rota: uma linha no `console.error`. */
function logToConsole(err: unknown) {
  console.error('[erro] origem=servidor rota=/api/me/export', err)
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const out: string[] = []
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return out
    out.push(decoder.decode(value))
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('textChunkStream', () => {
  it('um pedaço por seção, na ordem, e fecha no fim', async () => {
    async function* gen() {
      yield '{'
      yield '"a": 1'
      yield '}'
    }
    expect(await readAll(textChunkStream(gen(), logToConsole))).toEqual(['{', '"a": 1', '}'])
  })

  it('o cliente cancela com uma seção pendente: sem linha de erro, e o gerador para de consultar', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onError = vi.fn(logToConsole)
    const section = deferred<string>()
    const produced: string[] = []
    let finished = false
    async function* gen() {
      try {
        yield '{'
        produced.push('recipes')
        yield await section.promise
        produced.push('reviews') // nunca: o cancelamento encerra o gerador antes
        yield '"reviews": []'
      } finally {
        finished = true
      }
    }

    const reader = textChunkStream(gen(), onError).getReader()
    expect((await reader.read()).value).toBeDefined()
    const pending = reader.read() // o `pull` fica esperando a seção do banco
    await flush()
    const cancelling = reader.cancel()
    await expect(pending).resolves.toEqual({ done: true, value: undefined })

    section.resolve('"recipes": []') // a consulta em curso termina depois do cancelamento
    await cancelling
    await flush()

    expect(onError).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
    expect(produced).toEqual(['recipes'])
    expect(finished).toBe(true)
  })

  it('falha do gerador com o cliente lendo: onError uma vez e a leitura rejeita (a conexão cai)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onError = vi.fn(logToConsole)
    const boom = new Error('banco caiu')
    async function* gen(): AsyncGenerator<string> {
      yield '{'
      throw boom
    }
    const reader = textChunkStream(gen(), onError).getReader()
    await reader.read()
    await expect(reader.read()).rejects.toBe(boom)
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(boom)
    expect(consoleError).toHaveBeenCalledOnce()
  })

  it('falha do gerador DEPOIS do cancelamento: também sem linha de erro', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onError = vi.fn(logToConsole)
    const section = deferred<void>()
    async function* gen(): AsyncGenerator<string> {
      yield '{'
      await section.promise
      throw new Error('a consulta em curso falhou')
    }
    const reader = textChunkStream(gen(), onError).getReader()
    await reader.read()
    const pending = reader.read()
    await flush()
    const cancelling = reader.cancel()
    await expect(pending).resolves.toMatchObject({ done: true })
    section.resolve()
    await cancelling
    await flush()
    expect(onError).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })
})
