import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb } from '@/server/deps'
import { GET as divergentStaleRoute } from '@/app/api/curate/translations/divergent-stale/route'
import { recipe } from '@/db/schema'
import { seedRecipe, seedTranslation, seedRecipeIngredient } from '../helpers/recipes'
import { seedSessionHeaders } from '../helpers/users'
import { fingerprintSource, fingerprintMt } from '@/domain/translation-fingerprint'
import { TRANSLATION_PROMPT_VERSION } from '@/domain/translation-prompt'

/**
 * Lista do Curador — defasadas-E-divergentes (issue #500, ADR-0031 dec.6). Prova que a
 * comparação de hash no app espelha a construção de `ensureTranslation` (mesmos campos/
 * ordenação) e que o gate de comunidade/moderação/papel é o MESMO de `translations/stale`
 * (#18/#23) — nunca vaza receita privada nem removida do pool.
 */

const SOURCE_TITULO = 'Feijoada'
const SOURCE_DESCRICAO = 'Ensopado de feijão-preto.'
const SOURCE_INGREDIENTE = 'feijão-preto'

// O `fingerprintSource` REAL da fonte semeada abaixo — espelha byte-a-byte o que
// `loadDivergentStaleTranslations` recomputa (locale original + raw_text ordenado).
const CURRENT_SOURCE_FINGERPRINT = fingerprintSource({
  titulo: SOURCE_TITULO,
  descricao: SOURCE_DESCRICAO,
  passos: null,
  notas: null,
  ingredientes: [{ ordem: 0, nome: SOURCE_INGREDIENTE }],
})

const MT_TITULO = 'Black bean stew'
const MT_DESCRICAO = 'A black bean stew.'

// O `fingerprintMt` REAL do conteúdo da linha en-US semeada abaixo (sem jsonb de ingrediente).
const CURRENT_MT_FINGERPRINT = fingerprintMt({
  titulo: MT_TITULO,
  descricao: MT_DESCRICAO,
  passos: null,
  notas: null,
  ingredientes: null,
})

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

function callRoute(headers?: Headers): Promise<Response> {
  return divergentStaleRoute(
    new Request('http://localhost/api/curate/translations/divergent-stale', { headers }),
  )
}

type Item = { recipeId: string; locale: string; provenance: string }

async function body(res: Response): Promise<{ divergentStale: Item[] }> {
  return (await res.json()) as { divergentStale: Item[] }
}

function has(items: Item[], recipeId: string, locale: string): boolean {
  return items.some((i) => i.recipeId === recipeId && i.locale === locale)
}

/** Semeia a Receita-fonte (pt-BR) com o MESMO conteúdo usado para computar os fingerprints "atuais" acima. */
async function seedSourceRecipe(input: {
  ownerId?: string | null
  visibility?: 'public' | 'private'
}): Promise<string> {
  const ownerId = input.ownerId ?? null
  const id = await seedRecipe({
    origin: ownerId ? 'ai_chat' : 'catalog',
    originalLocale: 'pt-BR',
    visibility: ownerId ? (input.visibility ?? 'public') : undefined,
    ownerId,
  })
  await seedTranslation({
    recipeId: id,
    locale: 'pt-BR',
    titulo: SOURCE_TITULO,
    descricao: SOURCE_DESCRICAO,
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeIngredient({ recipeId: id, ordem: 0, rawText: SOURCE_INGREDIENTE })
  return id
}

/** Semeia a linha DERIVADA (en-US) com o conteúdo dos fingerprints "atuais" acima + os fingerprints GRAVADOS de teste. */
async function seedDerivedRow(
  recipeId: string,
  stored: { sourceFingerprint: string | null; mtFingerprint: string | null; promptVersion?: number | null },
): Promise<void> {
  await seedTranslation({
    recipeId,
    locale: 'en-US',
    titulo: MT_TITULO,
    descricao: MT_DESCRICAO,
    provenance: 'automatica_nao_revisada',
    sourceFingerprint: stored.sourceFingerprint,
    mtFingerprint: stored.mtFingerprint,
    promptVersion: stored.promptVersion ?? TRANSLATION_PROMPT_VERSION,
  })
}

async function moderationRemove(recipeId: string, curatorId: string): Promise<void> {
  await getDb()
    .update(recipe)
    .set({ moderationRemovedAt: new Date(), moderationReason: 'spam', moderatedBy: curatorId })
    .where(eq(recipe.id, recipeId))
}

describe('GET /api/curate/translations/divergent-stale (#500, ADR-0031 dec.6)', () => {
  it('defasada (fonte mudou) E divergente (conteúdo já diverge da MT gravada) ⇒ aparece', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador-500-a@ex.com', role: 'curador' })
    const id = await seedSourceRecipe({})
    await seedDerivedRow(id, { sourceFingerprint: 'fingerprint-antigo', mtFingerprint: 'mt-antigo-diferente' })

    const res = await callRoute(headers)
    expect(res.status).toBe(200)
    const { divergentStale } = await body(res)
    expect(has(divergentStale, id, 'en-US')).toBe(true)
  })

  it('defasada mas INTOCADA (mt_fingerprint bate com o conteúdo atual) ⇒ NÃO aparece (é a fatia B)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador-500-b@ex.com', role: 'curador' })
    const id = await seedSourceRecipe({})
    await seedDerivedRow(id, { sourceFingerprint: 'fingerprint-antigo', mtFingerprint: CURRENT_MT_FINGERPRINT })

    const res = await callRoute(headers)
    const { divergentStale } = await body(res)
    expect(has(divergentStale, id, 'en-US')).toBe(false)
  })

  it('legado sem mt_fingerprint (NULL) + fonte mudou ⇒ aparece', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador-500-c@ex.com', role: 'curador' })
    const id = await seedSourceRecipe({})
    await seedDerivedRow(id, { sourceFingerprint: 'fingerprint-antigo', mtFingerprint: null })

    const res = await callRoute(headers)
    const { divergentStale } = await body(res)
    expect(has(divergentStale, id, 'en-US')).toBe(true)
  })

  it('NÃO defasada (fonte + versão batem) mesmo com mt divergente ⇒ NÃO aparece', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador-500-d@ex.com', role: 'curador' })
    const id = await seedSourceRecipe({})
    await seedDerivedRow(id, { sourceFingerprint: CURRENT_SOURCE_FINGERPRINT, mtFingerprint: 'mt-divergente' })

    const res = await callRoute(headers)
    const { divergentStale } = await body(res)
    expect(has(divergentStale, id, 'en-US')).toBe(false)
  })

  it('intocada E não-defasada (tudo bate) ⇒ NÃO aparece', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador-500-e@ex.com', role: 'curador' })
    const id = await seedSourceRecipe({})
    await seedDerivedRow(id, {
      sourceFingerprint: CURRENT_SOURCE_FINGERPRINT,
      mtFingerprint: CURRENT_MT_FINGERPRINT,
    })

    const res = await callRoute(headers)
    const { divergentStale } = await body(res)
    expect(has(divergentStale, id, 'en-US')).toBe(false)
  })

  it('defasada por VERSÃO (prompt_version < atual, fonte bate) + divergente ⇒ aparece', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador-500-f@ex.com', role: 'curador' })
    const id = await seedSourceRecipe({})
    await seedDerivedRow(id, {
      sourceFingerprint: CURRENT_SOURCE_FINGERPRINT,
      mtFingerprint: 'mt-divergente',
      promptVersion: TRANSLATION_PROMPT_VERSION - 1,
    })

    const res = await callRoute(headers)
    const { divergentStale } = await body(res)
    expect(has(divergentStale, id, 'en-US')).toBe(true)
  })

  it('MUST-FIX: receita PRIVADA de usuário — defasada-e-divergente ⇒ NÃO vaza (404 leak-safe é a lista vazia dessa linha)', async () => {
    const { userId: ownerId } = await seedSessionHeaders({ email: 'owner-500-priv@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'curador-500-priv@ex.com', role: 'curador' })
    const id = await seedSourceRecipe({ ownerId, visibility: 'private' })
    await seedDerivedRow(id, { sourceFingerprint: 'fingerprint-antigo', mtFingerprint: 'mt-antigo-diferente' })

    const res = await callRoute(headers)
    const { divergentStale } = await body(res)
    expect(has(divergentStale, id, 'en-US')).toBe(false)
  })

  it('#18: receita PÚBLICA removida do pool pela moderação — defasada-e-divergente ⇒ NÃO vaza', async () => {
    const { userId: ownerId } = await seedSessionHeaders({ email: 'owner-500-mod@ex.com' })
    const { userId: curatorId, headers } = await seedSessionHeaders({
      email: 'curador-500-mod@ex.com',
      role: 'curador',
    })
    const id = await seedSourceRecipe({ ownerId, visibility: 'public' })
    await seedDerivedRow(id, { sourceFingerprint: 'fingerprint-antigo', mtFingerprint: 'mt-antigo-diferente' })
    await moderationRemove(id, curatorId)

    const res = await callRoute(headers)
    const { divergentStale } = await body(res)
    expect(has(divergentStale, id, 'en-US')).toBe(false)
  })

  it('catálogo (owner NULL) defasada-e-divergente ⇒ aparece (comunidade inclui catálogo aprovado)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador-500-catalog@ex.com', role: 'curador' })
    const id = await seedSourceRecipe({})
    await seedDerivedRow(id, { sourceFingerprint: 'fingerprint-antigo', mtFingerprint: 'mt-antigo-diferente' })

    const res = await callRoute(headers)
    const { divergentStale } = await body(res)
    const item = divergentStale.find((i) => i.recipeId === id && i.locale === 'en-US')
    expect(item?.provenance).toBe('automatica_nao_revisada')
  })

  it('usuario ⇒ 403', async () => {
    const { headers } = await seedSessionHeaders({ email: 'user-500@ex.com', role: 'usuario' })
    const res = await callRoute(headers)
    expect(res.status).toBe(403)
  })

  it('anônimo ⇒ 401', async () => {
    const res = await callRoute()
    expect(res.status).toBe(401)
  })
})
