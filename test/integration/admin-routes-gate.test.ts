import { describe, expect, it, vi, beforeEach } from 'vitest'
import { seedSessionHeaders, seedDeletedSessionHeaders } from '../helpers/users'

/**
 * Gate de ROTA aninhada do Console (#125). Prova, contra Postgres real e sessões reais
 * (prior art `admin-config`/`roles`), que CADA rota filha revalida o papel server-side:
 *  - `/admin` (layout) e as seções de Curadoria exigem curador+ — usuario → denied, anon → redirect.
 *  - `/admin/ia` e `/admin/users` exigem ADMIN — um CURADOR é barrado (denied), não só link
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
import { CatalogDisclosureConfigSection } from '@/components/admin/catalog-disclosure-config-section'
import { AiConfigSection } from '@/components/admin/ai-config-section'

/** Busca recursiva por um TIPO de componente na árvore resolvida (children aninhados). */
function containsType(node: unknown, target: unknown): boolean {
  if (!isValidElement(node)) return false
  const el = node as ReactElement<{ children?: unknown }>
  if (el.type === target) return true
  const kids = el.props?.children
  const arr = Array.isArray(kids) ? kids : [kids]
  return arr.some((k) => containsType(k, target))
}

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
// ADR-0020: as rotas agora vivem sob `[locale]` (locale-no-caminho, #228). Os imports
// apontam pro novo caminho; o gate de papel em si (o que este teste prova) não mudou.
const layout = () => as(import('@/app/[locale]/admin/layout'))
const index = () => as(import('@/app/[locale]/admin/page'))
const config = () => as(import('@/app/[locale]/admin/ia/page'))
const ai = () => as(import('@/app/[locale]/admin/descoberta/page'))
const vocabulario = () => as(import('@/app/[locale]/admin/vocabulario/page'))
const users = () => as(import('@/app/[locale]/admin/users/page'))
const moderation = () => as(import('@/app/[locale]/admin/moderation/page'))
const translations = () => as(import('@/app/[locale]/admin/translations/page'))
const catalog = () => as(import('@/app/[locale]/admin/catalog/page'))

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
  it('admin → /admin/ia (Governança)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'adm@idx.test', role: 'admin' })
    headersMock.current = headers
    expect(await run(index)).toEqual({ kind: 'redirect', to: '/admin/ia' })
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

describe('Seções admin-only (/admin/ia, /admin/descoberta, /admin/users) — curador é BARRADO', () => {
  it.each([
    ['config', config],
    ['ai', ai],
    ['vocabulario', vocabulario],
    ['users', users],
  ] as const)('curador em /admin/%s → AccessDenied (gate, não link escondido)', async (_n, mod) => {
    const { headers } = await seedSessionHeaders({ email: `cur-${_n}@routes.test`, role: 'curador' })
    headersMock.current = headers
    expect(await run(mod)).toEqual({ kind: 'denied' })
  })

  it.each([
    ['config', config],
    ['ai', ai],
    ['vocabulario', vocabulario],
    ['users', users],
  ] as const)('admin em /admin/%s → render da seção', async (_n, mod) => {
    const { headers } = await seedSessionHeaders({ email: `adm-${_n}@routes.test`, role: 'admin' })
    headersMock.current = headers
    expect(await run(mod)).toEqual({ kind: 'render' })
  })

  it.each([
    ['config', config],
    ['ai', ai],
    ['vocabulario', vocabulario],
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

  // #268: /admin/catalog passou a sondar o gate admin (gateSection('admin')) ANTES do SectionGate
  // curador. Pro anônimo essa sonda devolve a STRING 'redirect' (não-throw) → isAdmin=false; o
  // redirect de verdade vem do SectionGate. Trava a invariante: a sonda nunca vira leak/render.
  it('anon em /admin/catalog → redirect (a sonda admin não converte anon em render)', async () => {
    headersMock.current = new Headers()
    expect(await run(catalog)).toEqual({ kind: 'redirect', to: '/sign-in' })
  })
})

describe('Aviso do catálogo (#268) — admin-only DENTRO da seção Curadoria de catálogo', () => {
  // O Aviso fala com `/api/admin/config` (admin). Mover pra /admin/catalog (curador+) NÃO pode
  // expor o form ao Curador (gating preservado): a página só o renderiza pra admin. A seção de
  // Curadoria em si (CatalogCuration) continua curador+ — provado pelos testes de gate acima.
  async function catalogTree(role: 'admin' | 'curador') {
    const { headers } = await seedSessionHeaders({ email: `disc-${role}@routes.test`, role })
    headersMock.current = headers
    const { default: Component } = await catalog()
    return resolve(await Component())
  }

  it('admin → a seção do Aviso do catálogo está presente', async () => {
    expect(containsType(await catalogTree('admin'), CatalogDisclosureConfigSection)).toBe(true)
  })

  it('curador → a seção do Aviso está AUSENTE (não vê o que a API recusaria com 403)', async () => {
    expect(containsType(await catalogTree('curador'), CatalogDisclosureConfigSection)).toBe(false)
  })
})

// #334: a reorg IA × Descoberta é PURAMENTE colocação de seção (AiConfigSection saiu de /admin/descoberta e
// foi pra /admin/ia). O gate por papel (testado acima) não distingue isso — um revert acidental
// (AiConfigSection de volta na /admin/descoberta) passaria no CI. Estes 2 testes PINAM a colocação reusando o
// mesmo harness containsType/resolve do Aviso do catálogo.
describe('Reorg abas IA × Descoberta (#334) — colocação da geração de imagem', () => {
  async function pageTree(loader: () => Promise<PageModule>, email: string) {
    const { headers } = await seedSessionHeaders({ email, role: 'admin' })
    headersMock.current = headers
    const { default: Component } = await loader()
    return resolve(await Component())
  }

  it('aba "IA" (/admin/ia) RENDERIZA a geração de imagem (AiConfigSection)', async () => {
    expect(containsType(await pageTree(config, 'reorg-ia@routes.test'), AiConfigSection)).toBe(true)
  })

  it('aba "Descoberta" (/admin/descoberta) NÃO renderiza a geração de imagem (AiConfigSection)', async () => {
    expect(containsType(await pageTree(ai, 'reorg-desc@routes.test'), AiConfigSection)).toBe(false)
  })
})
