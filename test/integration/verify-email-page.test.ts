import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Tela de chegada do link de confirmação `/{locale}/verify-email` (#470) — Server Component rodado de verdade
 * contra sessões reais (padrão de admin-routes-gate). Mockamos só as bordas do Next: `redirect` lança uma
 * sentinela inspecionável e `headers()` devolve os headers da sessão semeada.
 */

class RedirectError extends Error {
  constructor(public to: string) {
    super(`NEXT_REDIRECT:${to}`)
  }
}
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectError(to)
  },
}))

const headersMock = vi.hoisted(() => ({ current: new Headers() }))
vi.mock('next/headers', () => ({
  headers: async () => headersMock.current,
}))

import VerifyEmailPage from '@/app/[locale]/verify-email/page'
import { VerifyEmailRetry } from '@/components/auth/verify-email-retry'

type Query = { returnTo?: string | string[]; error?: string | string[] }

/** Roda a page: `{ redirect }` se redirecionou, `{ element }` se renderizou. */
async function run(locale: string, query: Query): Promise<{ redirect?: string; element?: ReactElement }> {
  try {
    const element = await VerifyEmailPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve(query) })
    return { element: element as ReactElement }
  } catch (e) {
    if (e instanceof RedirectError) return { redirect: e.to }
    throw e
  }
}

/** Acha o VerifyEmailRetry na árvore e devolve suas props. */
function findRetry(node: unknown): { returnTo: string } | null {
  if (!isValidElement(node)) return null
  const el = node as ReactElement<{ children?: unknown; returnTo?: string }>
  if (el.type === VerifyEmailRetry) return { returnTo: el.props.returnTo! }
  const kids = Array.isArray(el.props.children) ? el.props.children : [el.props.children]
  for (const k of kids) {
    const found = findRetry(k)
    if (found) return found
  }
  return null
}

beforeEach(() => {
  headersMock.current = new Headers()
})

describe('/{locale}/verify-email (#470)', () => {
  it('com sessão (link acabou de logar) → segue pro returnTo', async () => {
    const { headers } = await seedSessionHeaders({ email: 'logada@page.test' })
    headersMock.current = headers
    expect(await run('pt-BR', { returnTo: '/u/ana' })).toEqual({ redirect: '/u/ana' })
  })

  it('sem sessão (link reaberto) → Entrar no locale do caminho, com "verified" e o returnTo', async () => {
    expect(await run('en-US', { returnTo: '/u/ana' })).toEqual({
      redirect: '/en-US/sign-in?verified=1&returnTo=%2Fu%2Fana',
    })
    expect(await run('pt-BR', {})).toEqual({ redirect: '/pt-BR/sign-in?verified=1' })
  })

  it('returnTo inseguro (outra origem, repetido) cai em "/"', async () => {
    const { headers } = await seedSessionHeaders({ email: 'segura@page.test' })
    headersMock.current = headers
    expect(await run('pt-BR', { returnTo: '//evil.test' })).toEqual({ redirect: '/' })
    expect(await run('pt-BR', { returnTo: 'https://evil.test' })).toEqual({ redirect: '/' })
    expect(await run('pt-BR', { returnTo: ['/a', '/b'] })).toEqual({ redirect: '/' })
  })

  it('locale desconhecido no caminho → DEFAULT_LOCALE no redirect pra Entrar', async () => {
    expect(await run('xx-YY', {})).toEqual({ redirect: '/pt-BR/sign-in?verified=1' })
  })

  it('com ?error → renderiza a tela de link inválido (com reenvio), levando o returnTo sanitizado', async () => {
    const out = await run('pt-BR', { error: 'INVALID_TOKEN', returnTo: '/u/ana' })
    expect(out.redirect).toBeUndefined()
    expect(findRetry(out.element)).toEqual({ returnTo: '/u/ana' })
    const unsafe = await run('pt-BR', { error: 'TOKEN_EXPIRED', returnTo: '//evil.test' })
    expect(findRetry(unsafe.element)).toEqual({ returnTo: '/' })
  })
})
