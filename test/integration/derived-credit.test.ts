import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { PUT as PUT_CREDIT } from '@/app/api/recipes/[id]/credit/route'
import { GET as GET_PREF, PUT as PUT_PREF } from '@/app/api/me/derivative-credit/route'
import { GET as GET_RECIPE } from '@/app/api/recipes/[id]/route'
import { GET as GET_EXPORT } from '@/app/api/me/export/route'
import { getDb } from '@/server/deps'
import { recipe, users } from '@/db/schema'
import { loadPublicRecipeBySlug } from '@/server/recipe/load'
import { loadDerivedCredit } from '@/server/recipe/derived-credit'
import { eraseOwnAccount } from '@/server/legal/account-erasure'
import type { RecipeView } from '@/domain/recipe-read'
import { seedSessionHeaders, seedUser } from '../helpers/users'
import { seedRecipe, seedTranslation } from '../helpers/recipes'

/**
 * Crédito público na Receita derivada (#610, ADR-0052, migração 0084): o loader (`loadDerivedCredit`) nos dois
 * caminhos da página (público por slug e `GET /api/recipes/[id]`), o "Retirar meu nome" do dono da base
 * (`PUT /api/recipes/[id]/credit`), a preferência em Editar perfil (`/api/me/derivative-credit`) e o export.
 */

async function seedBase(input: {
  ownerId: string | null
  visibility?: 'public' | 'private'
  titulo?: string
  slug?: string
}): Promise<string> {
  const id = await seedRecipe({
    origin: input.ownerId == null ? 'catalog' : 'ai_chat',
    originalLocale: 'pt-BR',
    ownerId: input.ownerId,
    visibility: input.visibility ?? (input.ownerId == null ? 'private' : 'public'),
  })
  await seedTranslation({
    recipeId: id,
    locale: 'pt-BR',
    titulo: input.titulo ?? 'Moqueca baiana',
    provenance: 'escrita_por_pessoa',
    slug: input.slug ?? `moqueca-${id.slice(0, 8)}`,
  })
  return id
}

async function seedDerived(input: {
  ownerId: string
  parentId: string
  visibility?: 'public' | 'private'
}): Promise<{ id: string; slug: string }> {
  const id = await seedRecipe({
    origin: 'user_edited',
    originalLocale: 'pt-BR',
    ownerId: input.ownerId,
    visibility: input.visibility ?? 'public',
    parentRecipeId: input.parentId,
    lineageKind: 'edited',
  })
  const slug = `minha-moqueca-${id.slice(0, 8)}`
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Minha moqueca', provenance: 'escrita_por_pessoa', slug })
  return { id, slug }
}

function putCredit(id: string, body: unknown, headers?: Headers): Promise<Response> {
  return PUT_CREDIT(
    new Request(`http://localhost/api/recipes/${id}/credit`, { method: 'PUT', headers, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  )
}

async function getView(id: string, headers?: Headers): Promise<RecipeView> {
  const res = await GET_RECIPE(new Request(`http://localhost/api/recipes/${id}?locale=pt-BR`, { headers }), {
    params: Promise.resolve({ id }),
  })
  expect(res.status).toBe(200)
  return (await res.json()) as RecipeView
}

async function publicBasedOn(slug: string) {
  const rows = await loadPublicRecipeBySlug(getDb(), slug, 'pt-BR')
  expect(rows).not.toBeNull()
  return (await loadDerivedCredit(getDb(), { recipe: rows!.recipe, locale: 'pt-BR' })).basedOn
}

async function creditRemovedAt(id: string): Promise<Date | null> {
  const [row] = await getDb().select({ at: recipe.creditRemovedAt }).from(recipe).where(eq(recipe.id, id))
  return row?.at ?? null
}

describe('crédito na derivada — leitura', () => {
  it('derivada pública de receita pública ⇒ "Baseada na receita" com link pelo slug e o @ da dona', async () => {
    const ana = await seedUser({ email: 'ana@credito.test', handle: 'ana-credito' })
    const bia = await seedUser({ email: 'bia@credito.test', handle: 'bia-credito' })
    const baseId = await seedBase({ ownerId: ana, slug: 'moqueca-da-ana' })
    const d = await seedDerived({ ownerId: bia, parentId: baseId })

    const esperado = { titulo: 'Moqueca baiana', href: '/pt-BR/recipes/moqueca-da-ana', author: { handle: 'ana-credito' } }
    expect(await publicBasedOn(d.slug)).toEqual(esperado)
    // O GET por uuid (caminho do dono e a busca do cliente) traz o mesmo, sem o controle para anônimo.
    const view = await getView(d.id)
    expect(view.basedOn).toEqual(esperado)
    expect(view).not.toHaveProperty('creditoDoAutor')
  })

  it('base de catálogo ⇒ crédito sem author ("do catálogo")', async () => {
    const bia = await seedUser({ email: 'bia2@credito.test' })
    const baseId = await seedBase({ ownerId: null, slug: 'feijoada-catalogo' })
    const d = await seedDerived({ ownerId: bia, parentId: baseId })
    expect(await publicBasedOn(d.slug)).toEqual({ titulo: 'Moqueca baiana', href: '/pt-BR/recipes/feijoada-catalogo' })
  })

  it('base privada, dona com o crédito desligado ou conta eliminada ⇒ nada (sem título nem link)', async () => {
    const ana = await seedUser({ email: 'ana3@credito.test' })
    const bia = await seedUser({ email: 'bia3@credito.test' })
    const privada = await seedBase({ ownerId: ana, visibility: 'private', titulo: 'Segredo da Ana' })
    expect(await publicBasedOn((await seedDerived({ ownerId: bia, parentId: privada })).slug)).toBeUndefined()

    const publica = await seedBase({ ownerId: ana })
    const d = await seedDerived({ ownerId: bia, parentId: publica })
    await getDb().update(users).set({ creditOnDerivatives: false }).where(eq(users.id, ana))
    expect(await publicBasedOn(d.slug)).toBeUndefined()

    // Eliminação (a receita pública fica, anonimizada): o crédito não aponta para a conta eliminada.
    const cida = await seedSessionHeaders({ email: 'cida@credito.test' })
    const daCida = await seedBase({ ownerId: cida.userId })
    const d2 = await seedDerived({ ownerId: bia, parentId: daCida })
    expect(await publicBasedOn(d2.slug)).toBeDefined()
    await eraseOwnAccount(getDb(), { userId: cida.userId })
    expect(await publicBasedOn(d2.slug)).toBeUndefined()
  })

  it('apagar a base (FK set null) ⇒ nada', async () => {
    const ana = await seedUser({ email: 'ana4@credito.test' })
    const bia = await seedUser({ email: 'bia4@credito.test' })
    const baseId = await seedBase({ ownerId: ana })
    const d = await seedDerived({ ownerId: bia, parentId: baseId })
    await getDb().delete(recipe).where(eq(recipe.id, baseId))
    expect(await publicBasedOn(d.slug)).toBeUndefined()
  })
})

describe('PUT /api/recipes/[id]/credit — "Retirar meu nome"', () => {
  it('a dona da base retira, o crédito some para todos e ela vê o desfazer; mostrar de novo devolve', async () => {
    const ana = await seedSessionHeaders({ email: 'ana5@credito.test' })
    const bia = await seedSessionHeaders({ email: 'bia5@credito.test' })
    const baseId = await seedBase({ ownerId: ana.userId })
    const d = await seedDerived({ ownerId: bia.userId, parentId: baseId })

    expect((await getView(d.id, ana.headers)).creditoDoAutor).toEqual({ exibir: true })
    expect((await getView(d.id, bia.headers)).creditoDoAutor).toBeUndefined()

    const res = await putCredit(d.id, { exibir: false }, ana.headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ exibir: false })
    const primeira = await creditRemovedAt(d.id)
    expect(primeira).toBeInstanceOf(Date)
    expect(await publicBasedOn(d.slug)).toBeUndefined()
    const daAna = await getView(d.id, ana.headers)
    expect(daAna.basedOn).toBeUndefined()
    expect(daAna.creditoDoAutor).toEqual({ exibir: false })

    // Retirar de novo mantém a data da primeira vez.
    expect((await putCredit(d.id, { exibir: false }, ana.headers)).status).toBe(200)
    expect((await creditRemovedAt(d.id))?.getTime()).toBe(primeira?.getTime())

    expect((await putCredit(d.id, { exibir: true }, ana.headers)).status).toBe(200)
    expect(await creditRemovedAt(d.id)).toBeNull()
    expect((await publicBasedOn(d.slug))?.author).toBeDefined()
  })

  it('retirado e depois a base ficou privada ou o crédito desligado ⇒ sem controle, e "mostrar de novo" é 404', async () => {
    const ana = await seedSessionHeaders({ email: 'ana9@credito.test' })
    const outro = await seedSessionHeaders({ email: 'outro9@credito.test' })
    const bia = await seedSessionHeaders({ email: 'bia9@credito.test' })
    const baseId = await seedBase({ ownerId: ana.userId })
    const d = await seedDerived({ ownerId: bia.userId, parentId: baseId })
    expect((await getView(d.id, outro.headers)).creditoDoAutor).toBeUndefined()

    expect((await putCredit(d.id, { exibir: false }, ana.headers)).status).toBe(200)
    await getDb().update(recipe).set({ visibility: 'private' }).where(eq(recipe.id, baseId))
    expect((await getView(d.id, ana.headers)).creditoDoAutor).toBeUndefined()
    expect((await putCredit(d.id, { exibir: true }, ana.headers)).status).toBe(404)
    expect(await creditRemovedAt(d.id)).toBeInstanceOf(Date)

    await getDb().update(recipe).set({ visibility: 'public' }).where(eq(recipe.id, baseId))
    await getDb().update(users).set({ creditOnDerivatives: false }).where(eq(users.id, ana.userId))
    expect((await getView(d.id, ana.headers)).creditoDoAutor).toBeUndefined()
    expect((await putCredit(d.id, { exibir: true }, ana.headers)).status).toBe(404)
  })

  it('anônimo 401; corpo inválido 400; dona da derivada, terceiro, uuid ruim e derivada privada 404', async () => {
    const ana = await seedSessionHeaders({ email: 'ana6@credito.test' })
    const bia = await seedSessionHeaders({ email: 'bia6@credito.test' })
    const outro = await seedSessionHeaders({ email: 'outro6@credito.test' })
    const baseId = await seedBase({ ownerId: ana.userId })
    const d = await seedDerived({ ownerId: bia.userId, parentId: baseId })
    const privada = await seedDerived({ ownerId: bia.userId, parentId: baseId, visibility: 'private' })

    expect((await putCredit(d.id, { exibir: false })).status).toBe(401)
    for (const body of [{}, { exibir: 'nao' }, null]) {
      expect((await putCredit(d.id, body, ana.headers)).status).toBe(400)
    }
    expect((await putCredit(d.id, { exibir: false }, bia.headers)).status).toBe(404)
    expect((await putCredit(d.id, { exibir: false }, outro.headers)).status).toBe(404)
    expect((await putCredit('nao-e-uuid', { exibir: false }, ana.headers)).status).toBe(404)
    expect((await putCredit(privada.id, { exibir: false }, ana.headers)).status).toBe(404)
    // A própria base (não é derivada) também é 404.
    expect((await putCredit(baseId, { exibir: false }, ana.headers)).status).toBe(404)
    expect(await creditRemovedAt(d.id)).toBeNull()
  })
})

describe('/api/me/derivative-credit — a preferência', () => {
  it('nasce ligada; PUT desliga e religa; só a própria linha; 401 e 400', async () => {
    const ana = await seedSessionHeaders({ email: 'ana7@credito.test' })
    const bia = await seedSessionHeaders({ email: 'bia7@credito.test' })
    expect((await GET_PREF(new Request('http://localhost/api/me/derivative-credit'))).status).toBe(401)

    const get = await GET_PREF(new Request('http://localhost/api/me/derivative-credit', { headers: ana.headers }))
    expect(get.headers.get('cache-control')).toBe('no-store')
    await expect(get.json()).resolves.toEqual({ creditar: true })

    const put = (body: unknown, headers?: Headers) =>
      PUT_PREF(new Request('http://localhost/api/me/derivative-credit', { method: 'PUT', headers, body: JSON.stringify(body) }))
    expect((await put({ creditar: false })).status).toBe(401)
    expect((await put({ creditar: 'sim' }, ana.headers)).status).toBe(400)
    const off = await put({ creditar: false }, ana.headers)
    await expect(off.json()).resolves.toEqual({ creditar: false })
    const [b] = await getDb().select({ c: users.creditOnDerivatives }).from(users).where(eq(users.id, bia.userId))
    expect(b?.c).toBe(true)
    await expect((await put({ creditar: true }, ana.headers)).json()).resolves.toEqual({ creditar: true })
  })

  it('entra no export (account.creditOnDerivatives)', async () => {
    const ana = await seedSessionHeaders({ email: 'ana8@credito.test' })
    await getDb().update(users).set({ creditOnDerivatives: false }).where(eq(users.id, ana.userId))
    const res = await GET_EXPORT(new Request('http://localhost/api/me/export', { headers: ana.headers }))
    const dump = (await res.json()) as { account: { creditOnDerivatives: boolean } }
    expect(dump.account.creditOnDerivatives).toBe(false)
  })
})
