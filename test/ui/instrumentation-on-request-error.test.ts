/**
 * Critério de saída da #590, lado SERVIDOR: um erro forçado numa rota vira UMA linha `[erro]` estruturada e
 * sem dado pessoal. Chama o `onRequestError` exportado de `src/instrumentation.ts` com a mesma forma que o
 * Next entrega (request `{ path, method, headers }` + contexto), com PII plantada no erro, no path (query) e
 * nos headers (cookie).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Instrumentation } from 'next'
import { onRequestError } from '@/instrumentation'

type Req = Parameters<Instrumentation.onRequestError>[1]
type Ctx = Parameters<Instrumentation.onRequestError>[2]

const request: Req = {
  path: '/pt-BR/u/maria?token=abc123',
  method: 'GET',
  headers: { cookie: 'better-auth.session_token=s3cr3t', 'x-real-ip': '203.0.113.9', referer: 'https://x/maria' },
}

const ctx: Ctx = {
  routerKind: 'App Router',
  routePath: '/[locale]/u/[handle]',
  routeType: 'render',
  renderSource: 'server-rendering',
  revalidateReason: undefined,
}

describe('onRequestError (instrumentation.ts)', () => {
  let spy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const lines = () => spy.mock.calls.map((c: unknown[]) => String(c[0]))

  it('erro forçado em rota ⇒ uma linha estruturada, sem mensagem, path, query, cookie nem IP', () => {
    const err = Object.assign(new TypeError('falhou para maria@x.com'), { digest: '2738485511@E394' })
    onRequestError(err, request, ctx)
    expect(lines()).toEqual([
      '[erro] origem=servidor rota=/[locale]/u/[handle] metodo=GET tipo=render fonte=server-rendering erro=TypeError digest=2738485511@E394',
    ])
    const line = lines()[0]
    for (const bad of ['maria', 'token', 'abc123', 'cookie', 's3cr3t', '203.0.113.9', 'falhou', '@x']) {
      expect(line).not.toContain(bad)
    }
  })

  it('valor lançado que não é Error usa o typeof', () => {
    onRequestError('maria@x.com', request, ctx)
    expect(lines()[0]).toContain(' erro=string digest=-')
    expect(lines()[0]).not.toContain('maria')
  })

  it('erro do Postgres embrulhado pelo Drizzle leva o SQLSTATE', () => {
    const err = Object.assign(new Error('Failed query: insert … maria', { cause: { code: '23505' } }), {
      name: 'DrizzleQueryError',
    })
    onRequestError(err, { ...request, method: 'POST' }, { ...ctx, routePath: '/api/recipes', routeType: 'route', renderSource: undefined })
    expect(lines()[0]).toBe(
      '[erro] origem=servidor rota=/api/recipes metodo=POST tipo=route fonte=- erro=DrizzleQueryError codigo=23505 digest=-',
    )
  })

  it('erro no proxy e revalidação aparecem no tipo e na revalidacao', () => {
    onRequestError(new Error('x'), request, { ...ctx, routePath: '/proxy', routeType: 'proxy', renderSource: undefined, revalidateReason: 'stale' })
    expect(lines()[0]).toBe('[erro] origem=servidor rota=/proxy metodo=GET tipo=proxy fonte=- revalidacao=stale erro=Error digest=-')
  })

  it('erro dentro do formatador não propaga (vira a linha mínima)', () => {
    const hostile = {
      get name(): string {
        throw new Error('getter hostil')
      },
    }
    expect(() => onRequestError(hostile, request, ctx)).not.toThrow()
    expect(lines()).toEqual(['[erro] origem=servidor formato=falhou'])
  })

  it('nem um console quebrado propaga', () => {
    spy.mockImplementation(() => {
      throw new Error('console caiu')
    })
    expect(() => onRequestError(new Error('x'), request, ctx)).not.toThrow()
  })
})
