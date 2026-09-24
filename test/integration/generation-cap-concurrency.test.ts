import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'
import { getDb, setClaudeClient } from '@/server/deps'
import { FakeClaudeClient } from '@/server/claude/client'
import { appConfig } from '@/db/schema'
import type { RecipeGenCapByRole } from '@/domain/recipe-gen-config'
import { DEFAULT_RECIPE_VARIANT_CONFIG } from '@/domain/recipe-variant-config'
import type { GenerationOutput } from '@/domain/generation'
import { seedSessionHeaders } from '../helpers/users'
import { cannedSuccess, makeBriefing, makeReceita, post } from '../helpers/generation'

/**
 * Teto de geração é uma corrida TOCTOU (#446) — prova de ATOMICIDADE pela porta mais alta.
 *
 * O teto era read-then-act NÃO-atômico (SELECT contagem → decide → INSERT, sem lock): sob READ
 * COMMITTED, N requisições concorrentes do MESMO usuário liam a contagem estale, TODAS passavam o cap
 * e TODAS persistiam ⇒ o teto era furado. O fix roda contagem+decisão+INSERT na MESMA transação, sob
 * `pg_advisory_xact_lock(userId)`. Este teste dispara `Promise.all` de N POSTs simultâneos e prova que
 * EXATAMENTE `cap` persistem (201) e o resto estoura (429) — o cap segura no limite EXATO.
 *
 * `setup.ts` faz resetDeps() + truncateAll antes de cada teste (app_config nasce vazia → defaults em
 * código salvo seed explícito). Usa o Postgres real com o seam do Claude trocado por um Fake.
 */

let sql: Sql
beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

async function setRecipeGenCap(caps: RecipeGenCapByRole): Promise<void> {
  await getDb()
    .insert(appConfig)
    .values({ id: true, recipeGenCapByRole: caps })
    .onConflictDoUpdate({ target: appConfig.id, set: { recipeGenCapByRole: caps } })
}

async function countGenerations(): Promise<number> {
  const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM generation`
  return r.n
}

/** Liga a OFERTA de variação (#423) + fixa o teto, na MESMA linha singleton app_config. */
async function setCapAndVariants(caps: RecipeGenCapByRole): Promise<void> {
  const variant = { ...DEFAULT_RECIPE_VARIANT_CONFIG, enabled: true }
  await getDb()
    .insert(appConfig)
    .values({ id: true, recipeGenCapByRole: caps, recipeVariantConfig: variant })
    .onConflictDoUpdate({
      target: appConfig.id,
      set: { recipeGenCapByRole: caps, recipeVariantConfig: variant },
    })
}

/** Lote de 2 variações válidas enlatadas (cada uma um pólo) p/ o FakeClaudeClient (5º arg). */
function cannedVariants(): GenerationOutput[] {
  const v = (variacao: string): GenerationOutput => ({
    kind: 'object',
    modelKind: 'success',
    recipe: makeReceita(),
    advisory: null,
    variacao,
  })
  return [v('tradicional'), v('com um toque criativo')]
}

describe('POST /api/generations — atomicidade do teto sob concorrência (#446)', () => {
  it('cap=3, 6 POSTs simultâneos ⇒ EXATAMENTE 3 persistem (201) e 3 estouram (429)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'race@cap.test' })
    await setRecipeGenCap({ usuario: 3, curador: 20, admin: null })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))

    // 6 requisições simultâneas do MESMO usuário. Cada uma passaria o pré-check estale (contagem 0 < 3)
    // e chamaria o Fake; só o gate ATÔMICO (advisory lock + recontagem) segura o cap no INSERT.
    const N = 6
    const results = await Promise.all(
      Array.from({ length: N }, () => post({ mode: 'structured', briefing: makeBriefing() }, headers)),
    )
    const statuses = results.map((r) => r.status)
    const ok = statuses.filter((s) => s === 201).length
    const limited = statuses.filter((s) => s === 429).length

    expect(ok).toBe(3) // EXATAMENTE o cap — nem mais (furo TOCTOU), nem menos (falso-negativo)
    expect(limited).toBe(3) // o restante estoura limpo
    expect(ok + limited).toBe(N) // nenhum 500/502 — todo mundo termina determinístico
    // A verdade do banco: nasceram EXATAMENTE `cap` generations, nunca mais.
    expect(await countGenerations()).toBe(3)

    // Os 429 carregam o contrato de sempre (limite_geracao + countdown).
    const limitedBody = (await results.find((r) => r.status === 429)!.json()) as {
      error: string
      retryAfterMs: number
    }
    expect(limitedBody.error).toBe('limite_geracao')
    expect(limitedBody.retryAfterMs).toBeGreaterThan(0)
  })

  it('cap=5 com 3 já gastas: 5 POSTs simultâneos ⇒ só 2 cabem (201), 3 estouram (429)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'race-partial@cap.test' })
    await setRecipeGenCap({ usuario: 5, curador: 20, admin: null })
    // Semeia 3 generations JÁ persistidas (via a rota, sequencial) p/ deixar 2 slots livres.
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    for (let i = 0; i < 3; i++) {
      const r = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
      expect(r.status).toBe(201)
    }
    expect(await countGenerations()).toBe(3)

    const results = await Promise.all(
      Array.from({ length: 5 }, () => post({ mode: 'structured', briefing: makeBriefing() }, headers)),
    )
    const ok = results.filter((r) => r.status === 201).length
    const limited = results.filter((r) => r.status === 429).length
    expect(ok).toBe(2) // só os 2 slots restantes
    expect(limited).toBe(3)
    expect(await countGenerations()).toBe(5) // fecha EXATAMENTE no cap
    void userId
  })

  it('variar2 (2 slots/req): cap=5, 4 pedidos "gerar 2" simultâneos ⇒ 2 pares cabem, 2 estouram', async () => {
    // #446 (achado dos reviews): as 2 variações agora persistem numa ÚNICA tx sob UM lock (effectiveCap=
    // cap-1). Sem isso, o slot "reservado" pela 1ª variação vazava entre as 2 tx. Cada par custa 2 slots;
    // com cap=5 cabem 2 pares (4 generations) e sobra 1 slot (um 3º par seria 6 > 5).
    const { headers } = await seedSessionHeaders({ email: 'race-variar2@cap.test' })
    await setCapAndVariants({ usuario: 5, curador: 20, admin: null })
    setClaudeClient(new FakeClaudeClient(undefined, undefined, undefined, undefined, cannedVariants()))

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        post({ mode: 'structured', briefing: makeBriefing(), variar2: true }, headers),
      ),
    )
    const ok = results.filter((r) => r.status === 201).length
    const limited = results.filter((r) => r.status === 429).length
    expect(ok).toBe(2) // 2 pares completos
    expect(limited).toBe(2)
    expect(await countGenerations()).toBe(4) // 2 pares × 2 = 4 generations, NUNCA 6 (cap segura no par)

    const limitedBody = (await results.find((r) => r.status === 429)!.json()) as { error: string }
    expect(limitedBody.error).toBe('limite_geracao_variacao')
  })
})
