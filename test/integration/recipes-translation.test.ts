import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { and, eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setTranslator, setEmbedder } from '@/server/deps'
import {
  FakeTranslator,
  ThrowingTranslator,
  type Translator,
  type TranslateInput,
  type TranslateOutput,
} from '@/server/translation/translator'
import { FakeEmbedder, type Embedder } from '@/server/embedding/embedder'
import { POST as translateRoute } from '@/app/api/recipes/[id]/translations/[locale]/route'
import { recipeTranslation } from '@/db/schema'
import { MESSAGES } from '@/i18n/messages'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation } from '../helpers/recipes'

/**
 * POST /api/recipes/[id]/translations/[locale] pela porta MAIS ALTA (issue #23, AC1 +
 * AC3 + AC4 + guards). `params` é PROMISE com AMBOS {id, locale}. Sem injeção o
 * RealTranslator lança ⇒ degraded ⇒ sem linha ⇒ asserção da view en-US fica vácua —
 * por isso SEMPRE injetamos FakeTranslator + FakeEmbedder(1536) no caminho feliz.
 */

const DIM = 1536

/** Translator-spy: conta chamadas e delega ao FakeTranslator (identidade). */
class CountingTranslator implements Translator {
  calls = 0
  private readonly inner = new FakeTranslator()
  async translate(input: TranslateInput): Promise<TranslateOutput> {
    this.calls++
    return this.inner.translate(input)
  }
}

/** Embedder-spy: conta chamadas e delega ao FakeEmbedder(1536). */
class CountingEmbedder implements Embedder {
  calls = 0
  private readonly inner = new FakeEmbedder(DIM)
  async embed(text: string): Promise<number[]> {
    this.calls++
    return this.inner.embed(text)
  }
}

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

type Flags = { locale: string; provenance: string; reliable: boolean; stale: boolean }
type StaleNotice = { locale: string; originalLocale: string; mensagem: string; verOriginalLabel: string }
type View = {
  id: string
  name: string
  translations: Flags[]
  staleNotice?: StaleNotice
}

function post(id: string, locale: string, headers?: Headers): Promise<Response> {
  return translateRoute(
    new Request(`http://localhost/api/recipes/${id}/translations/${locale}`, {
      method: 'POST',
      headers,
    }),
    { params: Promise.resolve({ id, locale }) },
  )
}

/** Receita do dono (private) com SÓ a origem pt-BR (sem 2º locale). */
async function seedOwned(ownerId: string): Promise<string> {
  const recipeId = await seedRecipe({
    origin: 'ai_chat',
    originalLocale: 'pt-BR',
    visibility: 'private',
    ownerId,
  })
  await seedTranslation({
    recipeId,
    locale: 'pt-BR',
    titulo: 'Bolo de fubá',
    descricao: 'Bolo simples de fubá.',
    provenance: 'escrita_por_pessoa',
  })
  return recipeId
}

describe('POST translations/[locale] #23 — AC1 caminho feliz', () => {
  it('dono autenticado ⇒ 200 + view com en-US automatica_nao_revisada/reliable:false', async () => {
    setTranslator(new FakeTranslator())
    setEmbedder(new FakeEmbedder(DIM))
    const { userId, headers } = await seedSessionHeaders({ email: 'owner-tr@ex.com' })
    const id = await seedOwned(userId)

    const res = await post(id, 'en-US', headers)
    expect(res.status).toBe(200)
    const view = (await res.json()) as View
    expect(view.id).toBe(id)
    const en = view.translations.find((t) => t.locale === 'en-US')
    expect(en).toMatchObject({ provenance: 'automatica_nao_revisada', reliable: false })
  })

  it('2ª chamada ⇒ 200 idempotente (mesma linha; 2º POST NÃO re-traduz nem re-embeda)', async () => {
    const translator = new CountingTranslator()
    const embedder = new CountingEmbedder()
    setTranslator(translator)
    setEmbedder(embedder)
    const { userId, headers } = await seedSessionHeaders({ email: 'owner-idem-tr@ex.com' })
    const id = await seedOwned(userId)

    expect((await post(id, 'en-US', headers)).status).toBe(200)
    // Contagens após o 1º POST (1 translate + 1 embed).
    const translatesAfterFirst = translator.calls
    const embedsAfterFirst = embedder.calls
    expect(translatesAfterFirst).toBe(1)
    expect(embedsAfterFirst).toBe(1)

    expect((await post(id, 'en-US', headers)).status).toBe(200)

    // LOAD-BEARING (early-exit "2º locale já existe"): o 2º POST adiciona ZERO
    // translate() e ZERO embed() — sem o early-exit, ambos seriam re-chamados.
    expect(translator.calls).toBe(translatesAfterFirst) // +0 traduções
    expect(embedder.calls).toBe(embedsAfterFirst) // +0 embeddings

    const rows = await getDb()
      .select({ locale: recipeTranslation.locale })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.recipeId, id), eq(recipeTranslation.locale, 'en-US')))
    expect(rows).toHaveLength(1)
  })

  it('casing: POST .../EN-US ⇒ linha nasce CANÔNICA en-US (nunca EN-US cru)', async () => {
    setTranslator(new FakeTranslator())
    setEmbedder(new FakeEmbedder(DIM))
    const { userId, headers } = await seedSessionHeaders({ email: 'owner-casing@ex.com' })
    const id = await seedOwned(userId)

    const res = await post(id, 'EN-US', headers)
    expect(res.status).toBe(200)

    const locales = (
      await getDb()
        .select({ locale: recipeTranslation.locale })
        .from(recipeTranslation)
        .where(eq(recipeTranslation.recipeId, id))
    ).map((r) => r.locale)
    expect(locales).toContain('en-US')
    expect(locales).not.toContain('EN-US')
  })
})

describe('POST translations/[locale] #23 — guards (404 leak-safe)', () => {
  it('anônimo ⇒ 401', async () => {
    const { userId } = await seedSessionHeaders({ email: 'owner-anon@ex.com' })
    const id = await seedOwned(userId)
    const res = await post(id, 'en-US') // sem headers
    expect(res.status).toBe(401)
  })

  it('receita inexistente ⇒ 404', async () => {
    const { headers } = await seedSessionHeaders({ email: 'owner-missing@ex.com' })
    const res = await post('00000000-0000-0000-0000-000000000000', 'en-US', headers)
    expect(res.status).toBe(404)
  })

  it('não-dono numa private ⇒ 404 (nunca 401/403 por existência)', async () => {
    setTranslator(new FakeTranslator())
    setEmbedder(new FakeEmbedder(DIM))
    const { userId: ownerA } = await seedSessionHeaders({ email: 'owner-a-priv@ex.com' })
    const { headers: headersB } = await seedSessionHeaders({ email: 'intruder-b-priv@ex.com' })
    const id = await seedOwned(ownerA)
    const res = await post(id, 'en-US', headersB)
    expect(res.status).toBe(404)
    // banco inalterado: nenhuma linha en-US criada por intruso.
    const rows = await getDb()
      .select({ locale: recipeTranslation.locale })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.recipeId, id), eq(recipeTranslation.locale, 'en-US')))
    expect(rows).toHaveLength(0)
  })

  it('id não-uuid ⇒ 404 sem 500', async () => {
    const { headers } = await seedSessionHeaders({ email: 'owner-badid-tr@ex.com' })
    const res = await post('not-a-uuid', 'en-US', headers)
    expect(res.status).toBe(404)
  })

  it('locale não suportado (fr-FR) ⇒ 404', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'owner-fr@ex.com' })
    const id = await seedOwned(userId)
    const res = await post(id, 'fr-FR', headers)
    expect(res.status).toBe(404)
  })

  it('catálogo (owner NULL) ⇒ 200 (acessível a qualquer logado)', async () => {
    setTranslator(new FakeTranslator())
    setEmbedder(new FakeEmbedder(DIM))
    const { headers } = await seedSessionHeaders({ email: 'someone-cat@ex.com' })
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({
      recipeId: id,
      locale: 'pt-BR',
      titulo: 'Feijoada',
      provenance: 'escrita_por_pessoa',
    })
    const res = await post(id, 'en-US', headers)
    expect(res.status).toBe(200)
  })
})

describe('POST translations/[locale] #23 — AC4 degradação na porta alta', () => {
  it('ThrowingTranslator ⇒ 200 com view só-original (sem linha en-US persistida)', async () => {
    setTranslator(new ThrowingTranslator())
    setEmbedder(new FakeEmbedder(DIM))
    const { userId, headers } = await seedSessionHeaders({ email: 'owner-degr@ex.com' })
    const id = await seedOwned(userId)

    const res = await post(id, 'en-US', headers)
    expect(res.status).toBe(200)
    const view = (await res.json()) as View
    // Só a origem aparece nas flags de tradução.
    expect(view.translations.map((t) => t.locale)).toEqual(['pt-BR'])

    const rows = await getDb()
      .select({ locale: recipeTranslation.locale })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.recipeId, id), eq(recipeTranslation.locale, 'en-US')))
    expect(rows).toHaveLength(0)
  })
})

describe('POST translations/[locale] #23 — AC3 aviso de stale na porta alta', () => {
  it('tradução en-US stale ⇒ staleNotice RENDERIZADO + view legível', async () => {
    // en-US já existe (confiável) mas STALE; o POST é no-op de geração (exists),
    // mas a view localizada deve trazer o aviso de stale renderizado.
    const { userId, headers } = await seedSessionHeaders({ email: 'owner-stale@ex.com' })
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'private',
      ownerId: userId,
    })
    await seedTranslation({
      recipeId: id,
      locale: 'pt-BR',
      titulo: 'Bolo de fubá',
      provenance: 'escrita_por_pessoa',
    })
    await seedTranslation({
      recipeId: id,
      locale: 'en-US',
      titulo: 'Cornmeal Cake',
      provenance: 'automatica_revisada',
      stale: true,
    })

    const res = await post(id, 'en-US', headers)
    expect(res.status).toBe(200)
    const view = (await res.json()) as View
    expect(view.staleNotice).toBeDefined()
    expect(view.staleNotice).toMatchObject({
      locale: 'en-US',
      originalLocale: 'pt-BR',
      mensagem: MESSAGES['en-US'].traducao.staleAviso,
      verOriginalLabel: MESSAGES['en-US'].traducao.verOriginal,
    })
    // A view continua legível (name presente).
    expect(view.name.length).toBeGreaterThan(0)
  })
})
