import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { recipe, users } from '@/db/schema'
import { loadRecommendedCooks } from '@/server/user/recommended-cooks'
import { follow } from '@/server/user/follow'
import { seedUser } from '../helpers/users'
import { seedRecipe, seedVote, seedFavorite, seedRemovedFromPool } from '../helpers/recipes'

/**
 * Loader do trilho "Cozinheiros pra seguir" (#278, ADR-0024) contra Postgres real. Cobre o RANKING por
 * popularidade (apreço de TERCEIROS = votos+favoritos, somados; recência como desempate), as EXCLUSÕES
 * (self, já-seguidos, soft-deletado, sem-receita-pública-elegível), o gate de elegibilidade (privada/
 * playful/moderada/web-imported/catálogo NUNCA contam nem aparecem) e a allowlist do DTO.
 *
 * As receitas são semeadas SEM tradução de propósito: a query do trilho não junta `recipe_translation`
 * (mostra só nome/@handle/avatar do Cozinheiro). Votos/favoritos são inseridos por OUTROS usuários
 * (apreço de terceiros) salvo nos testes que exercitam o filtro de auto-apreço.
 */

/** Semeia um Cozinheiro com UMA receita pública elegível (ai_chat public owned). Devolve ids. */
async function seedCook(opts: { email: string; handle: string; name?: string; recipeId?: string }) {
  const cookId = await seedUser({ email: opts.email, handle: opts.handle, name: opts.name })
  const recipeId = await seedRecipe({
    id: opts.recipeId,
    origin: 'ai_chat',
    originalLocale: 'pt-BR',
    visibility: 'public',
    ownerId: cookId,
  })
  return { cookId, recipeId }
}

/** Vários "outros" usuários (votantes/favoritadores distintos do dono). */
async function seedVoters(n: number): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    ids.push(await seedUser({ email: `voter-${i}-${crypto.randomUUID()}@ex.com` }))
  }
  return ids
}

async function setCreatedAt(recipeId: string, iso: string): Promise<void> {
  await getDb().update(recipe).set({ createdAt: new Date(iso) }).where(eq(recipe.id, recipeId))
}

describe('loadRecommendedCooks (#278) — ranking por popularidade', () => {
  it('ordena por apreço de terceiros (votos+favoritos) desc', async () => {
    const voters = await seedVoters(4)
    const pop = await seedCook({ email: 'pop@c.test', handle: 'pop' }) // 3 votos
    const mid = await seedCook({ email: 'mid@c.test', handle: 'mid' }) // 1 voto + 1 favorito
    const baixo = await seedCook({ email: 'baixo@c.test', handle: 'baixo' }) // 1 favorito

    for (const v of voters.slice(0, 3)) await seedVote({ userId: v, recipeId: pop.recipeId })
    await seedVote({ userId: voters[0], recipeId: mid.recipeId })
    await seedFavorite({ userId: voters[1], recipeId: mid.recipeId })
    await seedFavorite({ userId: voters[0], recipeId: baixo.recipeId })

    const cooks = await loadRecommendedCooks(getDb(), { limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['pop', 'mid', 'baixo'])
  })

  it('SOMA voto+favorito NA MESMA receita sem multiplicar (anti fan-out)', async () => {
    // seis: 6 votos de terceiros = score 6 (SEM favoritos ⇒ fan-out impossível). Semeado PRIMEIRO
    // (receita mais antiga) de propósito: num bug de multiplicação, `cinco` empata em 6 e o desempate
    // por recência colocaria `cinco` (receita mais nova) À FRENTE de `seis` — quebrando a ordem abaixo.
    const seis = await seedCook({ email: 'seis@c.test', handle: 'seis' })
    for (const v of await seedVoters(6)) await seedVote({ userId: v, recipeId: seis.recipeId })
    // cinco: 2 votos + 3 favoritos NA MESMA receita = score 5 CORRETO (um JOIN ingênuo daria 2×3 = 6).
    const cinco = await seedCook({ email: 'cinco@c.test', handle: 'cinco' })
    const v5 = await seedVoters(5)
    await seedVote({ userId: v5[0], recipeId: cinco.recipeId })
    await seedVote({ userId: v5[1], recipeId: cinco.recipeId })
    await seedFavorite({ userId: v5[2], recipeId: cinco.recipeId })
    await seedFavorite({ userId: v5[3], recipeId: cinco.recipeId })
    await seedFavorite({ userId: v5[4], recipeId: cinco.recipeId })
    // quatro: 4 votos = score 4.
    const quatro = await seedCook({ email: 'quatro@c.test', handle: 'quatro' })
    for (const v of await seedVoters(4)) await seedVote({ userId: v, recipeId: quatro.recipeId })

    const cooks = await loadRecommendedCooks(getDb(), { limit: 50 })
    // CORRETO 6>5>4 ⇒ seis, cinco, quatro. Um fan-out (cinco=6) empataria com seis e a recência jogaria
    // cinco à frente ⇒ esta asserção FALHARIA — é o que a torna um guarda real da multiplicação.
    expect(cooks.map((c) => c.handle)).toEqual(['seis', 'cinco', 'quatro'])
  })

  it('SOMA apreço ENTRE várias receitas do mesmo Cozinheiro', async () => {
    const voters = await seedVoters(3)
    const cookId = await seedUser({ email: 'multi@c.test', handle: 'multi' })
    const rA = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: cookId })
    const rB = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: cookId })
    await seedVote({ userId: voters[0], recipeId: rA }) // 1 na A
    await seedVote({ userId: voters[1], recipeId: rB })
    await seedVote({ userId: voters[2], recipeId: rB }) // 2 na B → total 3
    const solo = await seedCook({ email: 'solo@c.test', handle: 'solo' })
    await seedVote({ userId: voters[0], recipeId: solo.recipeId }) // 1

    const cooks = await loadRecommendedCooks(getDb(), { limit: 50 })
    const multi = cooks.find((c) => c.handle === 'multi')
    expect(multi?.recipeCount).toBe(2)
    expect(cooks.map((c) => c.handle)).toEqual(['multi', 'solo']) // 3 > 1
  })

  it('AUTO-favorito e AUTO-voto NÃO levantam o score (apreço de terceiros)', async () => {
    const outro = (await seedVoters(1))[0]
    // selfOnly: o dono favorita E vota na própria receita (raw insert burla o write-path). Score 0.
    const selfOnly = await seedCook({ email: 'self@c.test', handle: 'self-only' })
    await seedFavorite({ userId: selfOnly.cookId, recipeId: selfOnly.recipeId })
    await seedVote({ userId: selfOnly.cookId, recipeId: selfOnly.recipeId })
    // umDeTerceiro: 1 favorito de OUTRO. Score 1 → fica ACIMA do selfOnly (que conta 0).
    const terceiro = await seedCook({ email: 'ter@c.test', handle: 'tem-um' })
    await seedFavorite({ userId: outro, recipeId: terceiro.recipeId })

    const cooks = await loadRecommendedCooks(getDb(), { limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['tem-um', 'self-only'])
  })

  it('recência (receita elegível mais nova) desempata score igual', async () => {
    // Dois Cozinheiros score 0; o de receita MAIS NOVA vem primeiro.
    const velho = await seedCook({ email: 'velho@c.test', handle: 'velho' })
    const novo = await seedCook({ email: 'novo@c.test', handle: 'novo' })
    await setCreatedAt(velho.recipeId, '2020-01-01T00:00:00.000Z')
    await setCreatedAt(novo.recipeId, '2025-01-01T00:00:00.000Z')

    const cooks = await loadRecommendedCooks(getDb(), { limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['novo', 'velho'])
  })

  it('Cozinheiro com score 0 ainda é candidato (≥1 receita pública elegível)', async () => {
    await seedCook({ email: 'zero@c.test', handle: 'zero' })
    const cooks = await loadRecommendedCooks(getDb(), { limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['zero'])
  })

  it('respeita o limit (top-N)', async () => {
    for (let i = 0; i < 5; i++) await seedCook({ email: `lim-${i}@c.test`, handle: `lim-${i}` })
    const cooks = await loadRecommendedCooks(getDb(), { limit: 3 })
    expect(cooks.length).toBe(3)
  })

  it('DTO = allowlist exata { name, handle, image, recipeCount } (sem id/email/role)', async () => {
    await seedCook({ email: 'dto@c.test', handle: 'dto-cook', name: 'DTO Cook' })
    const cooks = await loadRecommendedCooks(getDb(), { limit: 50 })
    expect(cooks).toHaveLength(1)
    expect(Object.keys(cooks[0]).sort()).toEqual(['handle', 'image', 'name', 'recipeCount'])
    expect(cooks[0]).toEqual({ name: 'DTO Cook', handle: 'dto-cook', image: null, recipeCount: 1 })
  })
})

describe('loadRecommendedCooks (#278) — exclusões', () => {
  it('exclui o próprio viewer (self)', async () => {
    const me = await seedCook({ email: 'me@c.test', handle: 'me-cook' })
    await seedCook({ email: 'outro@c.test', handle: 'outro-cook' })
    const cooks = await loadRecommendedCooks(getDb(), { viewerId: me.cookId, limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['outro-cook'])
  })

  it('exclui quem o viewer JÁ SEGUE', async () => {
    const viewerId = await seedUser({ email: 'viewer@c.test', handle: 'viewer' })
    const seguido = await seedCook({ email: 'seg@c.test', handle: 'seguido' })
    await seedCook({ email: 'nao-seg@c.test', handle: 'nao-seguido' })
    await follow(getDb(), viewerId, seguido.cookId)
    const cooks = await loadRecommendedCooks(getDb(), { viewerId, limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['nao-seguido'])
  })

  it('exclui Cozinheiro soft-deletado', async () => {
    await seedCook({ email: 'vivo@c.test', handle: 'vivo' })
    const morto = await seedCook({ email: 'morto@c.test', handle: 'morto' })
    await getDb().update(users).set({ deletedAt: new Date() }).where(eq(users.id, morto.cookId))
    const cooks = await loadRecommendedCooks(getDb(), { limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['vivo'])
  })

  it('exclui quem NÃO tem receita pública elegível (privada/playful/moderada/web/catálogo)', async () => {
    const curatorId = await seedUser({ email: 'cur@c.test', handle: 'curador', role: 'curador' })

    // privada-só
    const priv = await seedUser({ email: 'priv@c.test', handle: 'so-privada' })
    await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', visibility: 'private', ownerId: priv })

    // playful-só (playful ⇒ sempre private pelo CHECK)
    const play = await seedUser({ email: 'play@c.test', handle: 'so-playful' })
    await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'private', resultKind: 'playful', ownerId: play })

    // moderada-só (public mas removida do pool)
    const mod = await seedUser({ email: 'mod@c.test', handle: 'so-moderada' })
    const modR = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: mod })
    await seedRemovedFromPool({ recipeId: modR, curatorId })

    // web_imported PÚBLICA (sem CHECK no DB; o eixo origin<>'web_imported' a barra)
    const web = await seedUser({ email: 'web@c.test', handle: 'so-web' })
    await seedRecipe({ origin: 'web_imported', originalLocale: 'pt-BR', visibility: 'public', ownerId: web })

    // catálogo (owner NULL) — sem Cozinheiro a ranquear
    await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', visibility: 'public', ownerId: null })

    // o único elegível
    await seedCook({ email: 'ok@c.test', handle: 'elegivel' })

    const cooks = await loadRecommendedCooks(getDb(), { limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['elegivel'])
  })

  it('apreço em receita INELEGÍVEL não levanta o Cozinheiro; recipeCount conta SÓ elegíveis', async () => {
    const voters = await seedVoters(3)
    // cook tem 1 pública (0 apreço) + 1 PRIVADA muito votada. Score 0; recipeCount 1.
    const cookId = await seedUser({ email: 'mix@c.test', handle: 'mix' })
    await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: cookId })
    const privR = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', visibility: 'private', ownerId: cookId })
    for (const v of voters) await seedVote({ userId: v, recipeId: privR })
    // outro cook com 1 voto público → deve ranquear ACIMA do mix (cujos votos privados não contam).
    const pub = await seedCook({ email: 'pub@c.test', handle: 'pub' })
    await seedVote({ userId: voters[0], recipeId: pub.recipeId })

    const cooks = await loadRecommendedCooks(getDb(), { limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['pub', 'mix'])
    expect(cooks.find((c) => c.handle === 'mix')?.recipeCount).toBe(1)
  })
})

describe('loadRecommendedCooks (#278) — caminho anônimo/global (viewerId undefined)', () => {
  it('SEM viewer: nenhuma exclusão; lista NÃO-vazia (sem binding de NULL)', async () => {
    // Mesmo que exista um grafo de seguir, sem viewer nada é excluído.
    const a = await seedCook({ email: 'ga@c.test', handle: 'g-a' })
    const b = await seedCook({ email: 'gb@c.test', handle: 'g-b' })
    await follow(getDb(), a.cookId, b.cookId) // a segue b — irrelevante sem viewer
    const cooks = await loadRecommendedCooks(getDb(), { viewerId: undefined, limit: 50 })
    expect(cooks.map((c) => c.handle).sort()).toEqual(['g-a', 'g-b'])
  })
})
