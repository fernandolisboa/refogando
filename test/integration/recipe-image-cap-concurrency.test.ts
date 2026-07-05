import { beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { POST } from '@/app/api/recipes/[id]/image/generate/route'
import { getDb, setImageStore, setImageGenerator } from '@/server/deps'
import { FakeImageStore } from '@/server/images/image-store'
import { FakeImageGenerator } from '@/server/images/image-generator'
import { appConfig, imageGeneration } from '@/db/schema'
import type { ImageGenCapByRole } from '@/domain/image-gen-config'
import { seedRecipe, seedTranslation, seedRecipeIngredient } from '../helpers/recipes'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Teto de geração de IMAGEM é a MESMA corrida TOCTOU (#446) — prova de ATOMICIDADE pela porta alta.
 *
 * O pré-check (SELECT no ledger `image_generation` → decideImageQuota) rodava fora da tx do INSERT;
 * N gerações concorrentes do MESMO usuário furavam o cap. O fix roda recontagem+decisão SOB
 * `pg_advisory_xact_lock` na MESMA tx que insere a recipe_image + o ledger. Aqui, `Promise.all` de N
 * gerações simultâneas na MESMA receita prova que EXATAMENTE `cap` eventos nascem no ledger.
 */

beforeEach(() => {
  setImageStore(new FakeImageStore())
  setImageGenerator(new FakeImageGenerator())
})

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
function genReq(id: string, headers: Headers): Request {
  return new Request(`http://localhost/api/recipes/${id}/image/generate`, {
    method: 'POST',
    headers: { ...Object.fromEntries(headers), 'content-type': 'application/json' },
  })
}

async function seedOwned(ownerId: string): Promise<string> {
  const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId, visibility: 'private', cozinha: 'brasileira' })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo de fubá', provenance: 'automatica_nao_revisada' })
  await seedRecipeIngredient({ recipeId: id, ingredientId: null, ordem: 0, rawText: 'fubá', quantidade: null })
  return id
}

async function setImageGenCap(capByRole: ImageGenCapByRole): Promise<void> {
  await getDb()
    .insert(appConfig)
    .values({ id: true, imageGenEnabled: true, imageGenCapByRole: capByRole })
    .onConflictDoUpdate({ target: appConfig.id, set: { imageGenEnabled: true, imageGenCapByRole: capByRole } })
}

async function countGenEvents(userId: string): Promise<number> {
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(imageGeneration)
    .where(eq(imageGeneration.userId, userId))
  return r?.n ?? 0
}

describe('POST /api/recipes/[id]/image/generate — atomicidade do teto sob concorrência (#446)', () => {
  it('cap=2, 5 gerações simultâneas ⇒ EXATAMENTE 2 no ledger (200) e 3 estouram (429)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'img-race@cap.test' })
    await setImageGenCap({ usuario: 2, curador: 5, admin: null })
    const id = await seedOwned(userId)

    const N = 5
    const results = await Promise.all(Array.from({ length: N }, () => POST(genReq(id, headers), ctx(id))))
    const ok = results.filter((r) => r.status === 200).length
    const limited = results.filter((r) => r.status === 429).length

    expect(ok).toBe(2) // EXATAMENTE o cap — o gate atômico segura no limite
    expect(limited).toBe(3)
    expect(ok + limited).toBe(N) // nenhum 500/503 — todo mundo termina determinístico
    expect(await countGenEvents(userId)).toBe(2) // o ledger conta EXATAMENTE `cap` eventos

    const limitedBody = (await results.find((r) => r.status === 429)!.json()) as {
      error: string
      retryAfterMs: number
    }
    expect(limitedBody.error).toBe('limite_geracao')
    expect(limitedBody.retryAfterMs).toBeGreaterThan(0)
  })
})
