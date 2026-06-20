import { describe, expect, it, vi, beforeEach } from 'vitest'
import { seedSessionHeaders, seedDeletedSessionHeaders } from '../helpers/users'

/**
 * Gate de ROTA aninhada do Console (#125). Prova, contra Postgres real e sessões reais
 * (prior art `admin-config`/`roles`), que CADA rota filha revalida o papel server-side:
 *  - `/admin` (layout) e as seções de Curadoria exigem curador+ — usuario → denied, anon → redirect.
 *  - `/admin/config` e `/admin/users` exigem ADMIN — um CURADOR é barrado (denied), não só link
 *    escondido. Esta é a lição da #51: gate de verdade na rota, não afordância de UI.
 *
 * Mockamos só as seams de borda do servidor (`next/headers` → headers da sessão semeada;
 * `next/navigation.redirect` → lança sentinela como o Next faz). A VERDADE (getSession +
 * decideSectionAccess) roda de verdade. Cada page é um Server Component fino que despacha
 * pelo veredito; aqui afirmamos o veredito observável: redirect (anon) vs AccessDenied
 * (papel insuficiente) vs render da seção.
 */

// redirect() do Next lança para abortar o render; imitamos com uma sentinela inspecionável.
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

// `headers()` do request: injetamos os headers da sessão semeada por teste.
const headersMock = vi.hoisted(() => ({ current: new Headers() }))
vi.mock('next/headers', () => ({
  headers: async () => headersMock.current,
}))

import { isValidElement, type ReactElement } from 'react'

/**
 * Resolve recursivamente Server Components ASSÍNCRONOS: as `page.tsx` de seção devolvem
 * `<SectionGate>` (outro async component), então é preciso "rodar" o tipo função até chegar
 * num elemento de DOM/host ou no `AccessDenied` (onde o veredito é observável). O `redirect`
 * lança a sentinela e aborta a cadeia. Tipos string (host) ou outros componentes = render.
 */
async function resolve(node: unknown): Promise<unknown> {
  if (!isValidElement(node)) return node
  const el = node as ReactElement<Record<string, unknown>>
  const type = el.type
  // Só descemos em Server Components ASSÍNCRONOS (ex.: `SectionGate`): são os que rodam o
  // gate. Componentes client (síncronos) — `ConsoleShell`, `AccessDenied`, as seções — NÃO
  // são invocados (usariam hooks fora do render React); ficam como o elemento = render.
  if (typeof type === 'function' && type.constructor.name === 'AsyncFunction') {
    const out = await (type as (p: unknown) => unknown)(el.props)
    return resolve(out)
  }
  return el
}

/**
 * Shape mínimo de um módulo de page/layout: o `default` é um Server Component. As assinaturas
 * variam (props opcionais vs `{ children }`), então tipamos como uma função que aceita um
 * record opcional — basta para invocar e resolver.
 */
type PageModule = { default: (props?: Record<string, unknown>) => Promise<unknown> }

/** Roda um Server Component page/layout e classifica o resultado observável. */
async function run(
  mod: () => Promise<PageModule>,
  props?: Record<string, unknown>,
): Promise<{ kind: 'redirect'; to: string } | { kind: 'denied' } | { kind: 'render' }> {
  const { default: Component } = await mod()
  try {
    const out = await resolve(await Component(props))
    const { AccessDenied } = await import('@/components/admin/access-denied')
    if (isValidElement(out) && out.type === AccessDenied) return { kind: 'denied' }
    return { kind: 'render' }
  } catch (e) {
    if (e instanceof RedirectError) return { kind: 'redirect', to: e.to }
    throw e
  }
}

// As assinaturas dos componentes de page/layout divergem do `PageModule` genérico (props
// tipadas vs opcionais); um cast por loader unifica para o resolvedor genérico do teste.
const as = (m: Promise<unknown>): Promise<PageModule> => m as Promise<PageModule>
const layout = () => as(import('@/app/admin/layout'))
const index = () => as(import('@/app/admin/page'))
const config = () => as(import('@/app/admin/config/page'))
const users = () => as(import('@/app/admin/users/page'))
const moderation = () => as(import('@/app/admin/moderation/page'))
const translations = () => as(import('@/app/admin/translations/page'))
const catalog = () => as(import('@/app/admin/catalog/page'))

beforeEach(() => {
  headersMock.current = new Headers()
})

describe('Gate da rota /admin (layout, curador+)', () => {
  it('anon → redirect ao sign-in', async () => {
    headersMock.current = new Headers()
    expect(await run(layout, { children: null })).toEqual({ kind: 'redirect', to: '/sign-in' })
  })

  it('conta soft-deletada → redirect ao sign-in', async () => {
    const { headers } = await seedDeletedSessionHeaders({ email: 'del@routes.test', role: 'admin' })
    headersMock.current = headers
    expect(await run(layout, { children: null })).toEqual({ kind: 'redirect', to: '/sign-in' })
  })

  it('usuario → AccessDenied (não passa do layout)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'u@routes.test', role: 'usuario' })
    headersMock.current = headers
    expect(await run(layout, { children: null })).toEqual({ kind: 'denied' })
  })

  it('curador → passa (render do shell com children)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cur@routes.test', role: 'curador' })
    headersMock.current = headers
    expect(await run(layout, { children: null })).toEqual({ kind: 'render' })
  })
})

describe('Index /admin redireciona para a primeira seção do papel', () => {
  it('admin → /admin/config (Governança)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'adm@idx.test', role: 'admin' })
    headersMock.current = headers
    expect(await run(index)).toEqual({ kind: 'redirect', to: '/admin/config' })
  })

  it('curador → /admin/moderation (Curadoria; sem Governança)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cur@idx.test', role: 'curador' })
    headersMock.current = headers
    expect(await run(index)).toEqual({ kind: 'redirect', to: '/admin/moderation' })
  })

  it('anon → redirect ao sign-in', async () => {
    headersMock.current = new Headers()
    expect(await run(index)).toEqual({ kind: 'redirect', to: '/sign-in' })
  })
})

describe('Seções admin-only (/admin/config, /admin/users) — curador é BARRADO', () => {
  it.each([
    ['config', config],
    ['users', users],
  ] as const)('curador em /admin/%s → AccessDenied (gate, não link escondido)', async (_n, mod) => {
    const { headers } = await seedSessionHeaders({ email: `cur-${_n}@routes.test`, role: 'curador' })
    headersMock.current = headers
    expect(await run(mod)).toEqual({ kind: 'denied' })
  })

  it.each([
    ['config', config],
    ['users', users],
  ] as const)('admin em /admin/%s → render da seção', async (_n, mod) => {
    const { headers } = await seedSessionHeaders({ email: `adm-${_n}@routes.test`, role: 'admin' })
    headersMock.current = headers
    expect(await run(mod)).toEqual({ kind: 'render' })
  })

  it.each([
    ['config', config],
    ['users', users],
  ] as const)('anon em /admin/%s → redirect', async (_n, mod) => {
    headersMock.current = new Headers()
    expect(await run(mod)).toEqual({ kind: 'redirect', to: '/sign-in' })
  })
})

describe('Seções de Curadoria (curador+) — curador E admin passam', () => {
  it.each([
    ['moderation', moderation],
    ['translations', translations],
    ['catalog', catalog],
  ] as const)('curador em /admin/%s → render da seção', async (_n, mod) => {
    const { headers } = await seedSessionHeaders({ email: `cur-${_n}@routes.test`, role: 'curador' })
    headersMock.current = headers
    expect(await run(mod)).toEqual({ kind: 'render' })
  })

  it.each([
    ['moderation', moderation],
    ['translations', translations],
    ['catalog', catalog],
  ] as const)('usuario em /admin/%s → AccessDenied', async (_n, mod) => {
    const { headers } = await seedSessionHeaders({ email: `u-${_n}@routes.test`, role: 'usuario' })
    headersMock.current = headers
    expect(await run(mod)).toEqual({ kind: 'denied' })
  })
})
