import { afterAll, beforeAll, describe, it, expect, inject } from 'vitest'
import type { Sql } from 'postgres'
import { inArray } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import { searchRecipes } from '@/server/recipe/search'
import { EMBEDDING_MODEL } from '@/server/embedding/recompute'
import { EMPTY_FACETS } from '@/domain/facet-params'
import { seedRecipe, seedTranslation, seedEmbedding, seedSave, seedReview } from '../helpers/recipes'
import { seedUser } from '../helpers/users'

/**
 * Ordenação por Popularidade na Busca da COMUNIDADE (issue #16→#368, ADR-0003/0027/0028), exercitando o
 * loader `searchRecipes` direto. A chave de Popularidade agora é a MISTURA (save + nota Bayesiana +
 * frescor) — não mais `vote_count`. Entra DENTRO do tier de exatidão (NUNCA acima — ADR-0008) e SÓ na
 * Comunidade (Catálogo editorial intocado). Sob sort=relevancia/ausente o ORDER BY colapsa byte-a-byte no
 * de hoje (#14). `setup.ts` trunca antes de cada teste (⇒ C global = fallback 3.0 quando não há nota viva).
 *
 * A FILA é carregada pelo sinal de SAVES (abundante, low-friction — o racional do ADR "Save evita o
 * cold-start"); as receitas são semeadas com `created_at` ~= now() ⇒ frescor ~igual pra todas ⇒ não
 * distorce a ordem DENTRO de um bucket. LANDMINES cobertas: self-save NÃO infla (write-path permite, o
 * ranking exclui), nota MODERADA NÃO infla (visível E bucket-2 semântico sob popularidade — o combo M1
 * que quebraria com created_at ausente no semanticSelectSql), nota de AUTOR soft-deletado E SAVE de saver
 * soft-deletado NÃO inflam (mesmo universo vivo — casa loadAggregate/C), catálogo imune, relevancia
 * byte-idêntica.
 *
 * Vetores 1536-dim PINADOS (base canônica), bind via literal pgvector.
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

const DIM = 1536
function vecCos(c: number): number[] {
  const v = new Array<number>(DIM).fill(0)
  v[0] = c
  v[1] = Math.sqrt(Math.max(0, 1 - c * c))
  return v
}
const QUERY_VEC = (() => {
  const v = new Array<number>(DIM).fill(0)
  v[0] = 1
  return v
})()

function indexOf(hits: { recipe_id: string }[], id: string): number {
  return hits.findIndex((h) => h.recipe_id === id)
}

/** Receita de COMUNIDADE pública (origin ai_chat, dono). Título + embedding opcional. */
async function seedCommunity(
  ownerId: string,
  titulo: string,
  cos: number | null,
  id?: string,
): Promise<string> {
  const recipeId = await seedRecipe({ id, origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId })
  await seedTranslation({ recipeId, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  if (cos !== null) await seedEmbedding({ recipeId, locale: 'pt-BR', embedding: vecCos(cos), model: EMBEDDING_MODEL })
  return recipeId
}

/** Receita de CATÁLOGO (owner NULL, visibility default). Título + embedding opcional. */
async function seedCatalog(titulo: string, cos: number | null, id?: string): Promise<string> {
  const recipeId = await seedRecipe({ id, origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({ recipeId, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  if (cos !== null) await seedEmbedding({ recipeId, locale: 'pt-BR', embedding: vecCos(cos), model: EMBEDDING_MODEL })
  return recipeId
}

/** N saves de terceiros DISTINTOS (cada um um Usuário novo ≠ dono). */
async function addSaves(recipeId: string, n: number, tag: string): Promise<void> {
  for (let i = 0; i < n; i++) {
    const uid = await seedUser({ email: `save-${tag}-${i}-${crypto.randomUUID()}@ex.com` })
    await seedSave({ userId: uid, recipeId })
  }
}

/** N avaliações de terceiros DISTINTOS, todas com `rating`, opcionalmente JÁ moderadas. */
async function addReviews(
  recipeId: string,
  n: number,
  rating: number,
  tag: string,
  moderatedBy?: string,
): Promise<void> {
  for (let i = 0; i < n; i++) {
    const uid = await seedUser({ email: `rev-${tag}-${i}-${crypto.randomUUID()}@ex.com` })
    await seedReview({
      userId: uid,
      recipeId,
      rating,
      ...(moderatedBy ? { moderated: { curatorId: moderatedBy } } : {}),
    })
  }
}

describe('Busca da Comunidade — ordenação por Popularidade (#368)', () => {
  // Tiering (ADR-0008): popularidade NÃO sobrepõe o bucket de exatidão.
  it('precisa-zero-save ranqueia ACIMA de só-semântica-muito-salva sob popularidade', async () => {
    const db = getDb()
    const owner = await seedUser({ email: `tier-owner-${crypto.randomUUID()}@ex.com` })
    const precise = await seedCommunity(owner, 'Chili de carne', 0.2) // bucket-1, 0 saves
    const semantic = await seedCommunity(owner, 'Ensopado apimentado da casa', 0.9) // bucket-2
    await addSaves(semantic, 5, 'tier')

    const { hits } = await searchRecipes(db, {
      q: 'Chili',
      terms: ['Chili'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: QUERY_VEC,
      sort: 'popularidade',
    })
    expect(indexOf(hits, precise)).toBeGreaterThanOrEqual(0)
    expect(indexOf(hits, semantic)).toBeGreaterThanOrEqual(0)
    expect(indexOf(hits, precise)).toBeLessThan(indexOf(hits, semantic))
  })

  it('DENTRO do bucket: a mais salva vem primeiro sob popularidade', async () => {
    const db = getDb()
    const owner = await seedUser({ email: `insidebucket-${crypto.randomUUID()}@ex.com` })
    const less = await seedCommunity(owner, 'Chili suave', null)
    const more = await seedCommunity(owner, 'Chili picante', null)
    await addSaves(more, 3, 'more')
    await addSaves(less, 1, 'less')

    const { hits } = await searchRecipes(db, {
      q: 'Chili',
      terms: ['Chili'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: null,
      sort: 'popularidade',
    })
    expect(indexOf(hits, more)).toBeGreaterThanOrEqual(0)
    expect(indexOf(hits, less)).toBeGreaterThanOrEqual(0)
    expect(indexOf(hits, more)).toBeLessThan(indexOf(hits, less))
  })

  it('sob relevância (sort ausente) a popularidade NÃO reordena o mesmo bucket', async () => {
    const db = getDb()
    const owner = await seedUser({ email: `rel-${crypto.randomUUID()}@ex.com` })
    const LO = '00000000-0000-4000-8000-0000000000a1'
    const HI = '00000000-0000-4000-8000-0000000000b2'
    const lo = await seedCommunity(owner, 'Chili A', null, LO)
    const hi = await seedCommunity(owner, 'Chili B', null, HI)
    await addSaves(hi, 9, 'rel-hi') // HI muito salva, mas relevância ignora popularidade

    const { hits } = await searchRecipes(db, {
      q: 'Chili',
      terms: ['Chili'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: null,
    })
    expect(indexOf(hits, lo)).toBeLessThan(indexOf(hits, hi)) // recipe_id ASC (LO<HI) apesar dos 9 saves
  })

  it('Catálogo mantém a ordem de relevância sob popularidade (saves não reordenam)', async () => {
    const db = getDb()
    const FIRST = '00000000-0000-4000-8000-0000000000c1'
    const SECOND = '00000000-0000-4000-8000-0000000000d2'
    const first = await seedCatalog('Chili editorial um', null, FIRST)
    const second = await seedCatalog('Chili editorial dois', null, SECOND)
    await addSaves(second, 7, 'cat-second') // muitos saves no que viria DEPOIS por relevância

    const { hits } = await searchRecipes(db, {
      q: 'Chili',
      terms: ['Chili'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: null,
      sort: 'popularidade',
    })
    // Catálogo IGNORA popularidade ⇒ recipe_id ASC preservado (FIRST antes de SECOND).
    expect(indexOf(hits, first)).toBeLessThan(indexOf(hits, second))
  })

  it('Comunidade com 0 sinal NÃO precede a mais salva (popularity_score nunca NULL ⇒ sem NULLS-FIRST)', async () => {
    const db = getDb()
    const owner = await seedUser({ email: `zero-${crypto.randomUUID()}@ex.com` })
    const zero = await seedCommunity(owner, 'Chili sem saves', null)
    const saved = await seedCommunity(owner, 'Chili salvo', null)
    await addSaves(saved, 4, 'zero')

    const { hits } = await searchRecipes(db, {
      q: 'Chili',
      terms: ['Chili'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: null,
      sort: 'popularidade',
    })
    expect(indexOf(hits, saved)).toBeLessThan(indexOf(hits, zero))
  })

  // LANDMINE B1-sec: self-save é permitido no write-path, mas NÃO infla o ranking.
  it('self-save do dono NÃO infla (tier visível)', async () => {
    const db = getDb()
    const owner = await seedUser({ email: `self-${crypto.randomUUID()}@ex.com` })
    const selfSaved = await seedCommunity(owner, 'Chili do dono', null)
    await seedSave({ userId: owner, recipeId: selfSaved }) // AUTO-save (raw) — deve ser ignorado
    const third = await seedCommunity(owner, 'Chili de terceiro', null)
    await addSaves(third, 1, 'self-third') // 1 save de OUTRO ⇒ deve superar o auto-save

    const { hits } = await searchRecipes(db, {
      q: 'Chili',
      terms: ['Chili'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: null,
      sort: 'popularidade',
    })
    expect(indexOf(hits, third)).toBeLessThan(indexOf(hits, selfSaved))
  })

  // LANDMINE M3 + B1-math: nota MODERADA NÃO conta; a fila fica pelo save. Não-vácuo: se a moderada
  // vazasse, o de MENOS saves (com 20 notas 5★ moderadas) furaria o de MAIS saves.
  it('nota MODERADA NÃO infla (tier visível): mais saves vence, moderada ignorada', async () => {
    const db = getDb()
    const curator = await seedUser({ email: `cur-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    const owner = await seedUser({ email: `mod-owner-${crypto.randomUUID()}@ex.com` })
    const high = await seedCommunity(owner, 'Chili muito salvo', null)
    await addSaves(high, 2, 'mod-high') // 2 saves, 0 notas
    const low = await seedCommunity(owner, 'Chili nota moderada', null)
    await addSaves(low, 1, 'mod-low')
    await addReviews(low, 20, 5, 'mod-low', curator) // 20 notas 5★ MAS moderadas ⇒ não contam

    const { hits } = await searchRecipes(db, {
      q: 'Chili',
      terms: ['Chili'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: null,
      sort: 'popularidade',
    })
    // Se a moderada vazasse, `low` (nota alta) subiria; correto ⇒ `high` (2 saves) fica na frente.
    expect(indexOf(hits, high)).toBeLessThan(indexOf(hits, low))
  })

  // LANDMINE (mesmo universo vivo): a NOTA de um autor SOFT-DELETADO não infla — espelha loadAggregate/C. A
  // fila fica pelo save. SHARP/não-vácuo: se o filtro `u.deleted_at IS NULL` do ratingAggBodySql caísse,
  // bayes(5,20,C=3,m=20)=4.0 e o score vazado de `low` (ln(2)+4.0=4.693) furaria `high` (ln(3)+3.0=4.099),
  // invertendo o bucket. O C global segue filtrando o autor morto ⇒ C=3.0 nos dois cenários.
  it('nota de autor SOFT-DELETADO NÃO infla (tier visível): mais saves vence, autor morto ignorado', async () => {
    const db = getDb()
    const owner = await seedUser({ email: `del-owner-${crypto.randomUUID()}@ex.com` })
    const high = await seedCommunity(owner, 'Chili bem salvo', null)
    await addSaves(high, 2, 'del-high') // 2 saves, 0 notas
    const low = await seedCommunity(owner, 'Chili nota de morto', null)
    await addSaves(low, 1, 'del-low')
    // 20 notas 5★ de autores DISTINTOS, soft-deletados DEPOIS ⇒ não contam (nem no C, nem no agregado).
    const reviewers: string[] = []
    for (let i = 0; i < 20; i++) {
      const uid = await seedUser({ email: `del-rev-${i}-${crypto.randomUUID()}@ex.com` })
      reviewers.push(uid)
      await seedReview({ userId: uid, recipeId: low, rating: 5 })
    }
    await db.update(users).set({ deletedAt: new Date() }).where(inArray(users.id, reviewers))

    const { hits } = await searchRecipes(db, {
      q: 'Chili',
      terms: ['Chili'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: null,
      sort: 'popularidade',
    })
    // Se a nota do autor morto vazasse, `low` subiria; correto ⇒ `high` (2 saves) fica na frente.
    expect(indexOf(hits, high)).toBeLessThan(indexOf(hits, low))
  })

  // LANDMINE (mesmo universo vivo do SAVE): o save de um usuário SOFT-DELETADO não infla — casa a NOTA (os
  // dois excluem apreciador morto). SHARP: se o `JOIN users ... deleted_at IS NULL` do savesAggBodySql caísse,
  // `morto` (2 saves de mortos) marcaria ln(3)+3.0=4.099 e furaria `vivo` (ln(2)+3.0=3.693). Com o filtro os
  // saves de mortos somem ⇒ `vivo` (1 save vivo) fica na frente.
  it('save de usuário SOFT-DELETADO NÃO infla (tier visível): saver morto ignorado', async () => {
    const db = getDb()
    const owner = await seedUser({ email: `dsave-owner-${crypto.randomUUID()}@ex.com` })
    const vivo = await seedCommunity(owner, 'Chili salvo por vivo', null)
    await addSaves(vivo, 1, 'dsave-vivo') // 1 save de usuário VIVO
    const morto = await seedCommunity(owner, 'Chili salvo por mortos', null)
    const savers: string[] = []
    for (let i = 0; i < 2; i++) {
      const uid = await seedUser({ email: `dsave-morto-${i}-${crypto.randomUUID()}@ex.com` })
      savers.push(uid)
      await seedSave({ userId: uid, recipeId: morto })
    }
    await db.update(users).set({ deletedAt: new Date() }).where(inArray(users.id, savers))

    const { hits } = await searchRecipes(db, {
      q: 'Chili',
      terms: ['Chili'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: null,
      sort: 'popularidade',
    })
    expect(indexOf(hits, vivo)).toBeLessThan(indexOf(hits, morto))
  })

  // Não-vácuo do filtro: uma nota NÃO-moderada idêntica DE FATO conta (a fila inverte). Como C = média
  // GLOBAL, com notas altas SÓ na receita testada C sobe junto e o Bayesiano não dá lift — então um
  // "lastro" de notas BAIXAS (numa receita que não casa a busca) puxa o C pra baixo, e aí as 5★ do
  // `rated` de fato o levantam sobre o prior. Isso prova que o termo de nota está VIVO no SQL.
  it('nota NÃO-moderada CONTA: com C controlado abaixo, a receita bem avaliada sobe (termo de nota vivo)', async () => {
    const db = getDb()
    const owner = await seedUser({ email: `live-owner-${crypto.randomUUID()}@ex.com` })
    // Lastro: 10 notas 1★ numa receita que NÃO casa "Chili" (não aparece nos hits, mas entra no C global).
    const ballast = await seedCommunity(owner, 'Bolo de lastro', null)
    await addReviews(ballast, 10, 1, 'ballast') // C global ~= (10*1 + 10*5)/20 = 3.0
    const high = await seedCommunity(owner, 'Chili salvo vivo', null)
    await addSaves(high, 2, 'live-high') // 2 saves, 0 notas ⇒ termo de nota = C
    const rated = await seedCommunity(owner, 'Chili bem avaliado vivo', null)
    await addSaves(rated, 1, 'live-rated')
    await addReviews(rated, 10, 5, 'live-rated') // 10 notas 5★ vivas ⇒ bayes(5,10,3,20)≈3.67 > C=3

    const { hits } = await searchRecipes(db, {
      q: 'Chili',
      terms: ['Chili'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: null,
      sort: 'popularidade',
    })
    // rated: ln(2)+~3.67 ≈ 4.36 ; high: ln(3)+3.0 ≈ 4.10 ⇒ rated à frente (a nota viva sobrepõe o save-a-mais).
    expect(indexOf(hits, rated)).toBeLessThan(indexOf(hits, high))
  })

  // LANDMINE M1 (o combo que quebraria com created_at ausente no semanticSelectSql): sort=popularidade +
  // queryVector + hit BUCKET-2 semântico com nota MODERADA. Deve RODAR sem erro E a moderada não inflar.
  it('bucket-2 sob popularidade+vetor: roda sem erro; nota moderada no só-semântico NÃO infla', async () => {
    const db = getDb()
    const curator = await seedUser({ email: `b2-cur-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    const owner = await seedUser({ email: `b2-owner-${crypto.randomUUID()}@ex.com` })
    // bucket-1 activator (título casa "Chili") pra o bucket-2 entrar nas seções (não virar sugestões).
    await seedCommunity(owner, 'Chili base', 0.2)
    // Dois só-semânticos (título NÃO casa "Chili"), cosseno IGUAL (0.9) ⇒ empate de cosseno ⇒ a
    // popularidade desempata DENTRO do bucket-2.
    const Y = '00000000-0000-4000-8000-0000000000e1' // id menor
    const X = '00000000-0000-4000-8000-0000000000f2' // id maior
    const y = await seedCommunity(owner, 'Ensopado apimentado Y', 0.9, Y)
    await addSaves(y, 2, 'b2-y') // 2 saves, 0 notas
    const x = await seedCommunity(owner, 'Caldo picante X', 0.9, X)
    await addSaves(x, 1, 'b2-x')
    await addReviews(x, 20, 5, 'b2-x', curator) // moderadas ⇒ não contam

    const { hits } = await searchRecipes(db, {
      q: 'Chili',
      terms: ['Chili'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: QUERY_VEC,
      sort: 'popularidade',
    })
    expect(indexOf(hits, y)).toBeGreaterThanOrEqual(0) // bucket-2 presente (created_at fix ⇒ sem 500)
    expect(indexOf(hits, x)).toBeGreaterThanOrEqual(0)
    // Y (2 saves) supera X (1 save); se a moderada de X vazasse, X furaria a fila.
    expect(indexOf(hits, y)).toBeLessThan(indexOf(hits, x))
  })

  // LANDMINE B1-sec no bucket-2: self-save num só-semântico também não infla.
  it('self-save NÃO infla no bucket-2', async () => {
    const db = getDb()
    const owner = await seedUser({ email: `b2self-${crypto.randomUUID()}@ex.com` })
    await seedCommunity(owner, 'Chili base dois', 0.2) // activator bucket-1
    const selfSaved = await seedCommunity(owner, 'Ensopado do dono', 0.9)
    await seedSave({ userId: owner, recipeId: selfSaved }) // auto-save (ignorado — self-exclusão)
    const third = await seedCommunity(owner, 'Caldo de terceiro', 0.9)
    await addSaves(third, 1, 'b2self-third')

    const { hits } = await searchRecipes(db, {
      q: 'Chili',
      terms: ['Chili'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: QUERY_VEC,
      sort: 'popularidade',
    })
    expect(indexOf(hits, third)).toBeLessThan(indexOf(hits, selfSaved))
  })

  // Regressão (UNION ALL / byte-idêntico): popularidade e relevância rodam sem erro; relevância produz a
  // MESMA ordem que o baseline (sort ausente). Prova a aridade intacta do UNION ALL com popularity_score.
  it('popularidade e relevância rodam sem erro SQL; relevância == baseline byte-a-byte', async () => {
    const db = getDb()
    const owner = await seedUser({ email: `reg-owner-${crypto.randomUUID()}@ex.com` })
    const p = await seedCommunity(owner, 'Sopa de mandioca', 0.2)
    const s = await seedCommunity(owner, 'Caldo verde da vovó', 0.9) // só-semântica
    const cat = await seedCatalog('Sopa de cebola', 0.3)
    await addSaves(s, 2, 'reg-s')
    await addSaves(p, 1, 'reg-p')
    await addReviews(p, 3, 4, 'reg-p') // um pouco de nota viva pra exercitar o termo Bayesiano

    const args = {
      q: 'Sopa',
      terms: ['Sopa'],
      mode: 'any' as const,
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: QUERY_VEC,
    }
    const pop = await searchRecipes(db, { ...args, sort: 'popularidade' })
    expect(pop.hits.length).toBeGreaterThan(0)
    expect(pop.hits.map((h) => h.recipe_id)).toEqual(expect.arrayContaining([p, s, cat]))

    const relExplicit = await searchRecipes(db, { ...args, sort: 'relevancia' })
    const baseline = await searchRecipes(db, args) // sem sort
    expect(relExplicit.hits.map((h) => h.recipe_id)).toEqual(baseline.hits.map((h) => h.recipe_id))
    expect(relExplicit.sugestoes.map((h) => h.recipe_id)).toEqual(baseline.sugestoes.map((h) => h.recipe_id))
  })
})
