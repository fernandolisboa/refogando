import { describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { recipe, users } from '@/db/schema'
import { loadRecommendedCooks } from '@/server/user/recommended-cooks'
import { decodeRecsCursor } from '@/domain/cooks-cursor'
import { follow } from '@/server/user/follow'
import { seedUser } from '../helpers/users'
import {
  seedRecipe,
  seedSave,
  seedReview,
  seedRemovedFromPool,
  seedTranslation,
  seedRecipeImage,
} from '../helpers/recipes'
import { RECOMMENDED_COOK_RECIPES_LIMIT } from '@/domain/recommended-cooks-read'

/**
 * Loader do trilho "Cozinheiros pra seguir" (#278→#368, ADR-0024/0027/0028) contra Postgres real. O
 * apreço mudou de `votos+favoritos` (contagem inteira) pra a MISTURA `cookScore = wSave·ln(1+total_saves)
 * + wNota·bayes(cook_avg, cook_count, C, m)` — SEM frescor aditivo (a recência é o desempate do keyset).
 *
 * A FILA é carregada pelo sinal de SAVES (ln monotônico ⇒ mais saves = score maior). Nos testes que
 * ISOLAM o save, as notas ficam ausentes OU todas em `rating=3` (com `setup.ts` truncando antes, o C
 * global vira 3.0 e `bayes(3,·,3,·)=3` pra todos ⇒ o termo de nota fica FLAT e não distorce a ordem).
 * Cobre: ordem por save, anti-fan-out (save×nota NÃO multiplica), self-exclusão (auto-save/auto-nota),
 * nota MODERADA excluída, autor de nota soft-deletado excluído, SAVER soft-deletado excluído (mesmo universo
 * vivo), recência de desempate e o cursor FLOAT (arredondado a 6 casas) caminhando TODAS as páginas sem
 * duplicar/pular.
 *
 * As receitas do `seedCook` são semeadas SEM tradução: o ranking não junta `recipe_translation`.
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

/** N "outros" usuários (apreciadores distintos do dono). */
async function seedOthers(n: number): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    ids.push(await seedUser({ email: `other-${i}-${crypto.randomUUID()}@ex.com` }))
  }
  return ids
}

/** N saves de terceiros DISTINTOS na receita. */
async function addSaves(recipeId: string, n: number): Promise<void> {
  for (const uid of await seedOthers(n)) await seedSave({ userId: uid, recipeId })
}

async function setCreatedAt(recipeId: string, iso: string): Promise<void> {
  await getDb().update(recipe).set({ createdAt: new Date(iso) }).where(eq(recipe.id, recipeId))
}

/**
 * Semeia uma receita pública elegível COM título (tradução original confiável) + opcionalmente recência e
 * imagem. Usado pelos testes do PREVIEW de receitas no cartão (ADR-0024 emendado).
 */
async function seedTitledRecipe(opts: {
  ownerId: string
  titulo: string
  locale?: string
  createdAt?: string
  image?: 'ai_generated' | 'user_photo' | 'moderated'
  curatorId?: string
}): Promise<string> {
  const locale = opts.locale ?? 'pt-BR'
  const recipeId = await seedRecipe({
    origin: 'ai_chat',
    originalLocale: locale,
    visibility: 'public',
    ownerId: opts.ownerId,
  })
  await seedTranslation({ recipeId, locale, titulo: opts.titulo, provenance: 'escrita_por_pessoa' })
  if (opts.createdAt) await setCreatedAt(recipeId, opts.createdAt)
  if (opts.image === 'moderated') {
    await seedRecipeImage({
      recipeId,
      provenance: 'ai_generated',
      moderated: { curatorId: opts.curatorId! },
    })
  } else if (opts.image) {
    await seedRecipeImage({ recipeId, provenance: opts.image })
  }
  return recipeId
}

describe('loadRecommendedCooks (#368) — ranking pela mistura de popularidade', () => {
  it('ordena por apreço de terceiros (saves) desc', async () => {
    const pop = await seedCook({ email: 'pop@c.test', handle: 'pop' })
    const mid = await seedCook({ email: 'mid@c.test', handle: 'mid' })
    const baixo = await seedCook({ email: 'baixo@c.test', handle: 'baixo' })
    await addSaves(pop.recipeId, 3)
    await addSaves(mid.recipeId, 2)
    await addSaves(baixo.recipeId, 1)

    const { cooks } = await loadRecommendedCooks(getDb(), { limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['pop', 'mid', 'baixo'])
  })

  it('anti fan-out: save + nota NA MESMA receita NÃO multiplicam o total de saves', async () => {
    // Notas todas em rating=3 ⇒ com o DB truncado, C=3 e bayes(3,·,3,·)=3 pra todos ⇒ termo de nota FLAT
    // ⇒ a ordem é puramente por saves (ln). seis(6) > quatro(4) > tres(3). Se um JOIN ingênuo
    // multiplicasse os 3 saves de `tres` pelas 3 notas (=9), `tres` furaria `seis` (ln10 > ln7).
    const seis = await seedCook({ email: 'seis@c.test', handle: 'seis' })
    await addSaves(seis.recipeId, 6)
    const quatro = await seedCook({ email: 'quatro@c.test', handle: 'quatro' })
    await addSaves(quatro.recipeId, 4)
    const tres = await seedCook({ email: 'tres@c.test', handle: 'tres' })
    await addSaves(tres.recipeId, 3)
    for (const uid of await seedOthers(3)) await seedReview({ userId: uid, recipeId: tres.recipeId, rating: 3 })

    const { cooks } = await loadRecommendedCooks(getDb(), { limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['seis', 'quatro', 'tres'])
  })

  it('SOMA saves ENTRE várias receitas do mesmo Cozinheiro', async () => {
    const others = await seedOthers(3)
    const cookId = await seedUser({ email: 'multi@c.test', handle: 'multi' })
    const rA = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: cookId })
    const rB = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: cookId })
    await seedSave({ userId: others[0], recipeId: rA }) // 1 na A
    await seedSave({ userId: others[1], recipeId: rB })
    await seedSave({ userId: others[2], recipeId: rB }) // 2 na B → total 3
    const solo = await seedCook({ email: 'solo@c.test', handle: 'solo' })
    await seedSave({ userId: others[0], recipeId: solo.recipeId }) // 1

    const { cooks } = await loadRecommendedCooks(getDb(), { limit: 50 })
    expect(cooks.find((c) => c.handle === 'multi')?.recipeCount).toBe(2)
    expect(cooks.map((c) => c.handle)).toEqual(['multi', 'solo']) // 3 > 1
  })

  it('AUTO-save e AUTO-nota do dono NÃO levantam o score (apreço de terceiros)', async () => {
    const outro = (await seedOthers(1))[0]
    // selfOnly: o dono salva E avalia a própria receita (raw insert burla o write-path). Não conta.
    const selfOnly = await seedCook({ email: 'self@c.test', handle: 'self-only' })
    await seedSave({ userId: selfOnly.cookId, recipeId: selfOnly.recipeId })
    await seedReview({ userId: selfOnly.cookId, recipeId: selfOnly.recipeId, rating: 5 })
    // terceiro: 1 save de OUTRO ⇒ fica ACIMA do selfOnly (que conta 0 apreço).
    const terceiro = await seedCook({ email: 'ter@c.test', handle: 'tem-um' })
    await seedSave({ userId: outro, recipeId: terceiro.recipeId })

    const { cooks } = await loadRecommendedCooks(getDb(), { limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['tem-um', 'self-only'])
  })

  it('nota MODERADA NÃO infla o cozinheiro (mais saves vence)', async () => {
    const curator = await seedUser({ email: 'curm@c.test', handle: 'curm', role: 'curador' })
    // modOnly: 1 save + 20 notas 5★ MODERADAS (não contam). plain: 2 saves, 0 notas.
    const modOnly = await seedCook({ email: 'modo@c.test', handle: 'mod-only' })
    await addSaves(modOnly.recipeId, 1)
    for (const uid of await seedOthers(20)) {
      await seedReview({ userId: uid, recipeId: modOnly.recipeId, rating: 5, moderated: { curatorId: curator } })
    }
    const plain = await seedCook({ email: 'plain@c.test', handle: 'plain-2s' })
    await addSaves(plain.recipeId, 2)

    const { cooks } = await loadRecommendedCooks(getDb(), { limit: 50 })
    // Se as moderadas vazassem, `mod-only` subiria; correto ⇒ `plain-2s` (2 saves) fica na frente.
    expect(cooks.map((c) => c.handle)).toEqual(['plain-2s', 'mod-only'])
  })

  it('autor de nota soft-deletado NÃO infla o cozinheiro', async () => {
    // delAuthor: 1 save + 20 notas 5★ de autores soft-deletados DEPOIS (não contam). ok: 2 saves.
    // SHARP (não-vácuo): 20 notas ⇒ se o filtro `ru.deleted_at IS NULL` do `rc` caísse, bayes(5,20,C=3,m=20)=4.0
    // e o score VAZADO de delAuthor (ln(2)+4.0=4.693) FURARIA ok (ln(3)+3.0=4.099), invertendo a ordem. Com o
    // filtro, as notas somem, delAuthor cai pra ln(2)+3.0=3.693 e ok (2 saves) fica na frente.
    const delAuthor = await seedCook({ email: 'dela@c.test', handle: 'del-author' })
    await addSaves(delAuthor.recipeId, 1)
    const reviewers = await seedOthers(20)
    for (const uid of reviewers) await seedReview({ userId: uid, recipeId: delAuthor.recipeId, rating: 5 })
    await getDb().update(users).set({ deletedAt: new Date() }).where(inArray(users.id, reviewers))
    const ok = await seedCook({ email: 'okc@c.test', handle: 'ok-cook' })
    await addSaves(ok.recipeId, 2)

    const { cooks } = await loadRecommendedCooks(getDb(), { limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['ok-cook', 'del-author'])
  })

  it('saver soft-deletado NÃO infla o cozinheiro', async () => {
    // vivo-saver: 1 save de usuário VIVO. morto-saver: 2 saves de usuários soft-deletados DEPOIS (não contam).
    // SHARP: sem o `su.deleted_at IS NULL` do `sc`, morto-saver marcaria ln(3)+3.0=4.099 e FURARIA vivo-saver
    // (ln(2)+3.0=3.693). Com o filtro, os saves de mortos somem ⇒ vivo-saver (1 save vivo) fica na frente.
    const vivoSaver = await seedCook({ email: 'vs@c.test', handle: 'vivo-saver' })
    await addSaves(vivoSaver.recipeId, 1)
    const mortoSaver = await seedCook({ email: 'ms@c.test', handle: 'morto-saver' })
    const savers = await seedOthers(2)
    for (const uid of savers) await seedSave({ userId: uid, recipeId: mortoSaver.recipeId })
    await getDb().update(users).set({ deletedAt: new Date() }).where(inArray(users.id, savers))

    const { cooks } = await loadRecommendedCooks(getDb(), { limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['vivo-saver', 'morto-saver'])
  })

  it('nota NÃO-moderada de terceiro CONTA (desempata acima do prior)', async () => {
    // Dois cozinheiros com 1 save cada; A ganha 4 notas 5★ vivas. Com C truncado (só estas notas ⇒ C=5,
    // bayes=5) A ainda leva pela nota sobre o prior; se as notas não contassem, empatariam no score e a
    // recência (aqui igual ~now) cairia no handle. Basta A ficar À FRENTE de B.
    const b = await seedCook({ email: 'bnr@c.test', handle: 'zzz-sem-nota' })
    await addSaves(b.recipeId, 1)
    const a = await seedCook({ email: 'anr@c.test', handle: 'aaa-com-nota' })
    await addSaves(a.recipeId, 1)
    for (const uid of await seedOthers(4)) await seedReview({ userId: uid, recipeId: a.recipeId, rating: 5 })

    const { cooks } = await loadRecommendedCooks(getDb(), { limit: 50 })
    const iA = cooks.findIndex((c) => c.handle === 'aaa-com-nota')
    const iB = cooks.findIndex((c) => c.handle === 'zzz-sem-nota')
    expect(iA).toBeGreaterThanOrEqual(0)
    expect(iA).toBeLessThan(iB)
  })

  it('recência (receita elegível mais nova) desempata score igual (0 sinal)', async () => {
    const velho = await seedCook({ email: 'velho@c.test', handle: 'velho' })
    const novo = await seedCook({ email: 'novo@c.test', handle: 'novo' })
    await setCreatedAt(velho.recipeId, '2020-01-01T00:00:00.000Z')
    await setCreatedAt(novo.recipeId, '2025-01-01T00:00:00.000Z')

    const { cooks } = await loadRecommendedCooks(getDb(), { limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['novo', 'velho'])
  })

  it('Cozinheiro com 0 sinal (score = piso wNota·C) ainda é candidato', async () => {
    await seedCook({ email: 'zero@c.test', handle: 'zero' })
    const { cooks } = await loadRecommendedCooks(getDb(), { limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['zero'])
  })

  it('respeita o limit (top-N)', async () => {
    for (let i = 0; i < 5; i++) await seedCook({ email: `lim-${i}@c.test`, handle: `lim-${i}` })
    const { cooks } = await loadRecommendedCooks(getDb(), { limit: 3 })
    expect(cooks.length).toBe(3)
  })

  it('DTO = allowlist exata { name, handle, image, recipeCount, recipes } (sem id/email/role/score)', async () => {
    await seedCook({ email: 'dto@c.test', handle: 'dto-cook', name: 'DTO Cook' })
    const { cooks } = await loadRecommendedCooks(getDb(), { limit: 50 })
    expect(cooks).toHaveLength(1)
    expect(Object.keys(cooks[0]).sort()).toEqual(['handle', 'image', 'name', 'recipeCount', 'recipes'])
    expect(cooks[0]).toEqual({
      name: 'DTO Cook',
      handle: 'dto-cook',
      image: null,
      recipeCount: 1,
      recipes: [],
    })
  })
})

describe('loadRecommendedCooks (ADR-0024 emendado) — preview de receitas no cartão', () => {
  it('traz ≤ N receitas mais NOVAS primeiro (cap + ordem), título localizado; recipeCount = total', async () => {
    const cookId = await seedUser({ email: 'rico@c.test', handle: 'rico', name: 'Rico' })
    await seedTitledRecipe({ ownerId: cookId, titulo: 'Mais antiga', createdAt: '2020-01-01T00:00:00.000Z' })
    await seedTitledRecipe({ ownerId: cookId, titulo: 'Receita B', createdAt: '2021-01-01T00:00:00.000Z' })
    await seedTitledRecipe({ ownerId: cookId, titulo: 'Receita C', createdAt: '2022-01-01T00:00:00.000Z' })
    await seedTitledRecipe({ ownerId: cookId, titulo: 'Mais nova', createdAt: '2023-01-01T00:00:00.000Z' })

    const { cooks } = await loadRecommendedCooks(getDb(), { limit: 50, requestLocale: 'pt-BR' })
    const rico = cooks.find((c) => c.handle === 'rico')!
    expect(rico.recipeCount).toBe(4)
    expect(rico.recipes).toHaveLength(RECOMMENDED_COOK_RECIPES_LIMIT)
    expect(rico.recipes.map((r) => r.displayedTitle)).toEqual(['Mais nova', 'Receita C', 'Receita B'])
  })

  it('allowlist: cada receita do preview só carrega {recipeId, displayedTitle(, slug, imageUrl, imageAiGenerated)}', async () => {
    const cookId = await seedUser({ email: 'all@c.test', handle: 'allow', name: 'Allow' })
    await seedTitledRecipe({ ownerId: cookId, titulo: 'Única' })
    const { cooks } = await loadRecommendedCooks(getDb(), { limit: 50 })
    const r = cooks.find((c) => c.handle === 'allow')!.recipes[0]
    const allowed = ['recipeId', 'displayedTitle', 'slug', 'imageUrl', 'imageAiGenerated']
    for (const k of Object.keys(r)) expect(allowed).toContain(k)
    expect(r.recipeId).toBeTruthy()
    expect(r.displayedTitle).toBe('Única')
  })

  it('imagem ai_generated ⇒ imageAiGenerated + imageUrl; imagem MODERADA some (sem imageUrl)', async () => {
    const curatorId = await seedUser({ email: 'cur2@c.test', handle: 'cur2', role: 'curador' })
    const cookId = await seedUser({ email: 'img@c.test', handle: 'imgs', name: 'Imgs' })
    await seedTitledRecipe({ ownerId: cookId, titulo: 'Com IA', createdAt: '2023-01-01T00:00:00.000Z', image: 'ai_generated' })
    await seedTitledRecipe({ ownerId: cookId, titulo: 'Moderada', createdAt: '2022-01-01T00:00:00.000Z', image: 'moderated', curatorId })

    const { cooks } = await loadRecommendedCooks(getDb(), { limit: 50 })
    const recipes = cooks.find((c) => c.handle === 'imgs')!.recipes
    const comIa = recipes.find((r) => r.displayedTitle === 'Com IA')!
    expect(comIa.imageAiGenerated).toBe(true)
    expect(comIa.imageUrl).toBeTruthy()
    const moderada = recipes.find((r) => r.displayedTitle === 'Moderada')!
    expect(moderada.imageUrl).toBeUndefined()
    expect(moderada.imageAiGenerated).toBeUndefined()
  })

  it('cozinheiro com receita SEM tradução ⇒ preview vazio (mas ainda candidato por recipeCount)', async () => {
    await seedCook({ email: 'semt@c.test', handle: 'sem-titulo' })
    const { cooks } = await loadRecommendedCooks(getDb(), { limit: 50 })
    const c = cooks.find((c) => c.handle === 'sem-titulo')!
    expect(c.recipeCount).toBe(1)
    expect(c.recipes).toEqual([])
  })

  it('locale ≠ original: título inclui a tradução do locale PEDIDO + slug vem do req_t (alias wiring)', async () => {
    const cookId = await seedUser({ email: 'xloc@c.test', handle: 'xloc', name: 'Xloc' })
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      ownerId: cookId,
    })
    await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Bolo de fubá', provenance: 'escrita_por_pessoa' })
    await seedTranslation({
      recipeId,
      locale: 'en-US',
      titulo: 'Cornmeal cake',
      provenance: 'escrita_por_pessoa',
      slug: 'cornmeal-cake',
    })

    const { cooks } = await loadRecommendedCooks(getDb(), { limit: 50, requestLocale: 'en-US' })
    const r = cooks.find((c) => c.handle === 'xloc')!.recipes[0]
    expect(r.displayedTitle).toContain('Cornmeal cake')
    expect(r.slug).toBe('cornmeal-cake')
  })
})

describe('loadRecommendedCooks (#278) — exclusões', () => {
  it('exclui o próprio viewer (self)', async () => {
    const me = await seedCook({ email: 'me@c.test', handle: 'me-cook' })
    await seedCook({ email: 'outro@c.test', handle: 'outro-cook' })
    const { cooks } = await loadRecommendedCooks(getDb(), { viewerId: me.cookId, limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['outro-cook'])
  })

  it('exclui quem o viewer JÁ SEGUE', async () => {
    const viewerId = await seedUser({ email: 'viewer@c.test', handle: 'viewer' })
    const seguido = await seedCook({ email: 'seg@c.test', handle: 'seguido' })
    await seedCook({ email: 'nao-seg@c.test', handle: 'nao-seguido' })
    await follow(getDb(), viewerId, seguido.cookId)
    const { cooks } = await loadRecommendedCooks(getDb(), { viewerId, limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['nao-seguido'])
  })

  it('exclui Cozinheiro soft-deletado', async () => {
    await seedCook({ email: 'vivo@c.test', handle: 'vivo' })
    const morto = await seedCook({ email: 'morto@c.test', handle: 'morto' })
    await getDb().update(users).set({ deletedAt: new Date() }).where(eq(users.id, morto.cookId))
    const { cooks } = await loadRecommendedCooks(getDb(), { limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['vivo'])
  })

  it('exclui quem NÃO tem receita pública elegível (privada/playful/moderada/web/catálogo)', async () => {
    const curatorId = await seedUser({ email: 'cur@c.test', handle: 'curador', role: 'curador' })

    const priv = await seedUser({ email: 'priv@c.test', handle: 'so-privada' })
    await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', visibility: 'private', ownerId: priv })

    const play = await seedUser({ email: 'play@c.test', handle: 'so-playful' })
    await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'private', resultKind: 'playful', ownerId: play })

    const mod = await seedUser({ email: 'mod@c.test', handle: 'so-moderada' })
    const modR = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: mod })
    await seedRemovedFromPool({ recipeId: modR, curatorId })

    const web = await seedUser({ email: 'web@c.test', handle: 'so-web' })
    await seedRecipe({ origin: 'web_imported', originalLocale: 'pt-BR', visibility: 'public', ownerId: web })

    await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', visibility: 'public', ownerId: null })

    await seedCook({ email: 'ok@c.test', handle: 'elegivel' })

    const { cooks } = await loadRecommendedCooks(getDb(), { limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['elegivel'])
  })

  it('apreço em receita INELEGÍVEL não levanta o Cozinheiro; recipeCount conta SÓ elegíveis', async () => {
    const others = await seedOthers(3)
    const cookId = await seedUser({ email: 'mix@c.test', handle: 'mix' })
    await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: cookId })
    const privR = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', visibility: 'private', ownerId: cookId })
    for (const uid of others) await seedSave({ userId: uid, recipeId: privR }) // saves na PRIVADA (não contam)
    const pub = await seedCook({ email: 'pub@c.test', handle: 'pub' })
    await seedSave({ userId: others[0], recipeId: pub.recipeId }) // 1 save público

    const { cooks } = await loadRecommendedCooks(getDb(), { limit: 50 })
    expect(cooks.map((c) => c.handle)).toEqual(['pub', 'mix'])
    expect(cooks.find((c) => c.handle === 'mix')?.recipeCount).toBe(1)
  })
})

describe('loadRecommendedCooks (#278) — caminho anônimo/global (viewerId undefined)', () => {
  it('SEM viewer: nenhuma exclusão; lista NÃO-vazia (sem binding de NULL)', async () => {
    const a = await seedCook({ email: 'ga@c.test', handle: 'g-a' })
    const b = await seedCook({ email: 'gb@c.test', handle: 'g-b' })
    await follow(getDb(), a.cookId, b.cookId)
    const { cooks } = await loadRecommendedCooks(getDb(), { viewerId: undefined, limit: 50 })
    expect(cooks.map((c) => c.handle).sort()).toEqual(['g-a', 'g-b'])
  })
})

/** Cozinheiro com UMA receita pública elegível numa cozinha específica. */
async function seedCookCozinha(opts: { email: string; handle: string; cozinha: string }) {
  const cookId = await seedUser({ email: opts.email, handle: opts.handle })
  const recipeId = await seedRecipe({
    origin: 'ai_chat',
    originalLocale: 'pt-BR',
    visibility: 'public',
    ownerId: cookId,
    cozinha: opts.cozinha as never,
  })
  return { cookId, recipeId }
}

describe('loadRecommendedCooks (#308) — filtro de cozinha (multi, OR-dentro-do-eixo)', () => {
  it('só cozinheiros com receita elegível na(s) cozinha(s); vazio = sem filtro', async () => {
    await seedCookCozinha({ email: 'i@c.test', handle: 'ita', cozinha: 'italiana' })
    await seedCookCozinha({ email: 'j@c.test', handle: 'jap', cozinha: 'japonesa' })
    await seedCookCozinha({ email: 'b@c.test', handle: 'bra', cozinha: 'brasileira' })

    const all = await loadRecommendedCooks(getDb(), { limit: 50, cozinhas: [] })
    expect(all.cooks.map((c) => c.handle).sort()).toEqual(['bra', 'ita', 'jap'])

    const so = await loadRecommendedCooks(getDb(), { limit: 50, cozinhas: ['italiana'] })
    expect(so.cooks.map((c) => c.handle)).toEqual(['ita'])

    const multi = await loadRecommendedCooks(getDb(), { limit: 50, cozinhas: ['italiana', 'japonesa'] })
    expect(multi.cooks.map((c) => c.handle).sort()).toEqual(['ita', 'jap'])

    const nenhum = await loadRecommendedCooks(getDb(), { limit: 50, cozinhas: ['mexicana'] })
    expect(nenhum.cooks).toEqual([])
  })

  it('score E recipeCount ficam ESCOPADOS na cozinha (saves de outra cozinha não contam)', async () => {
    const others = await seedOthers(3)
    const cookId = await seedUser({ email: 'dois@c.test', handle: 'dois-cozinhas' })
    const ita = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: cookId, cozinha: 'italiana' as never })
    const jap = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: cookId, cozinha: 'japonesa' as never })
    for (const uid of others) await seedSave({ userId: uid, recipeId: jap }) // 3 saves NA JAPONESA
    await seedSave({ userId: others[0], recipeId: ita }) // 1 save na italiana
    const rival = await seedCookCozinha({ email: 'riv@c.test', handle: 'rival-ita', cozinha: 'italiana' })
    await seedSave({ userId: others[0], recipeId: rival.recipeId })
    await seedSave({ userId: others[1], recipeId: rival.recipeId })

    const f = await loadRecommendedCooks(getDb(), { limit: 50, cozinhas: ['italiana'] })
    expect(f.cooks.find((c) => c.handle === 'dois-cozinhas')?.recipeCount).toBe(1)
    expect(f.cooks.map((c) => c.handle)).toEqual(['rival-ita', 'dois-cozinhas']) // 2 > 1 no escopo italiano
  })
})

describe('loadRecommendedCooks (#308/#368) — paginação keyset com score FLOAT', () => {
  it('percorre TODOS sem dup/skip (limit 1, cursor float round-trip em TODA borda); nextCursor null no fim', async () => {
    // saves distintos 5..1 ⇒ ln distintos ⇒ scores FLOAT distintos e determinísticos.
    for (const [h, saves] of [['c5', 5], ['c4', 4], ['c3', 3], ['c2', 2], ['c1', 1]] as const) {
      const cook = await seedCook({ email: `${h}@c.test`, handle: h })
      await addSaves(cook.recipeId, saves)
    }
    const seen: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 20; i++) {
      const page = await loadRecommendedCooks(getDb(), { limit: 1, cursor: cursor ? decodeRecsCursor(cursor) : null })
      seen.push(...page.cooks.map((c) => c.handle))
      cursor = page.nextCursor
      if (!cursor) break
    }
    // Score é float (round a 6 casas): o cursor carrega o MESMO float ⇒ a borda é reproduzível ⇒ sem
    // duplicar/pular ao caminhar 1-a-1.
    expect(seen).toEqual(['c5', 'c4', 'c3', 'c2', 'c1'])
  })

  it('keyset estável no EMPATE EXATO de score float (0 sinal): desempata por recência, depois handle', async () => {
    // Dois cozinheiros 0 sinal ⇒ score = wNota·C IDÊNTICO (mesmo float arredondado) ⇒ o empate cai na
    // recência; limit 1 atravessa o empate sem dup/skip.
    const novo = await seedCook({ email: 'novo@c.test', handle: 'aaa-novo' })
    const velho = await seedCook({ email: 'velho@c.test', handle: 'zzz-velho' })
    await setCreatedAt(novo.recipeId, '2026-06-29T12:00:00Z')
    await setCreatedAt(velho.recipeId, '2020-01-01T00:00:00Z')
    const p1 = await loadRecommendedCooks(getDb(), { limit: 1 })
    expect(p1.cooks.map((c) => c.handle)).toEqual(['aaa-novo'])
    const p2 = await loadRecommendedCooks(getDb(), { limit: 1, cursor: decodeRecsCursor(p1.nextCursor!) })
    expect(p2.cooks.map((c) => c.handle)).toEqual(['zzz-velho'])
    expect(p2.nextCursor).toBeNull()
  })

  it('nextCursor NÃO vaza o id interno (allowlist #269) — só score/recency/handle', async () => {
    await seedCook({ email: 'x@c.test', handle: 'aaa' })
    await seedCook({ email: 'y@c.test', handle: 'bbb' })
    const page = await loadRecommendedCooks(getDb(), { limit: 1 })
    expect(page.nextCursor).not.toBeNull()
    const decoded = Buffer.from(page.nextCursor as string, 'base64url').toString('utf8')
    expect(decoded).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i)
  })
})
