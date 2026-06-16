import { afterAll, beforeAll, describe, it, expect, inject } from 'vitest'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'
import { GET } from '@/app/api/search/route'
import { seedIngredientSearchMatrix, seedSearchMatrix } from '../helpers/recipes'

/**
 * Busca por INGREDIENTE (issue #9) pela porta MAIS ALTA — handler GET de `/api/search`.
 * Estende a FTS precisa da #6: um termo de `?q=` resolve OU ao Ingrediente canônico
 * (nome/alias, ALL-LOCALE) OU degrada para FTS sobre `recipe_ingredient.raw_text`. Mesmo
 * seccionamento {catálogo,comunidade}, mesmo gate de leitura, mesmo cap, mesmo DTO
 * congelado. `?match=any|all`. Visitante anônimo. NUNCA cria.
 *
 * `setup.ts` aponta o DI para o Postgres descartável e trunca antes de cada teste.
 * Modelo de invocação (porta alta com Request cru) copiado de search.test.ts (#6). Para
 * o caminho set-null e os invariantes de SQL cru usa-se o cliente RAW postgres-js
 * (makeSql), espelhando search.test.ts/recipe-constraints.test.ts.
 */

type SearchResult = {
  recipeId: string
  displayedTitle: string
  origin: string
  autoTranslationSignal: boolean
}
type SearchResponse = { catalogo: SearchResult[]; comunidade: SearchResult[] }

/** Busca pela porta alta. `match` adiciona ?match=. Sem headers = Visitante ANÔNIMO. */
function search(q: string, locale?: string, match?: 'any' | 'all'): Promise<Response> {
  const params = new URLSearchParams({ q })
  if (locale) params.set('locale', locale)
  if (match) params.set('match', match)
  return GET(new Request(`http://localhost/api/search?${params.toString()}`))
}

async function searchBody(q: string, locale?: string, match?: 'any' | 'all'): Promise<SearchResponse> {
  const res = await search(q, locale, match)
  expect(res.status).toBe(200)
  return (await res.json()) as SearchResponse
}

const ids = (results: SearchResult[]): string[] => results.map((r) => r.recipeId)
const allIds = (body: SearchResponse): string[] => [...ids(body.catalogo), ...ids(body.comunidade)]

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

describe('GET /api/search — Busca por Ingrediente (#9)', () => {
  it('AC1: cross-locale canônico — frango pt-BR acha R_cross (Item escrito em inglês); controles negativos', async () => {
    const m = await seedIngredientSearchMatrix()

    // frango (pt-BR) resolve o canônico cujo Item foi escrito em INGLÊS ('chicken
    // thighs'), via ALL-LOCALE. R_cross é catálogo (owner NULL) → seção catalogo.
    const body = await searchBody('frango', 'pt-BR')
    expect(ids(body.catalogo)).toContain(m.R_cross)

    // O título exibido NÃO precisa conter 'frango' — a linha veio do sinal de ingrediente,
    // não do título ('Grilled thighs over coals').
    const hit = body.catalogo.find((r) => r.recipeId === m.R_cross)
    expect(hit, 'esperava R_cross presente no catálogo').toBeDefined()
    expect((hit as SearchResult).displayedTitle.toLowerCase()).not.toContain('frango')

    // Controle negativo (a): a resolução canônica é o ÚNICO laço entre o termo pt-BR
    // 'frango' e o Item escrito em inglês. Uma query que não resolve NENHUM canônico nem
    // casa o título/raw_text de R_cross ('chá de hortelã' — nada em comum com R_cross) NÃO
    // a traz → prova que não há surface acidental.
    const byUnrelated = await searchBody('chá de hortelã', 'pt-BR')
    expect(allIds(byUnrelated)).not.toContain(m.R_cross)

    // Controle negativo (b) — caminho set-null (autoritativo): anular o ingredient_id do
    // Item de R_cross (FK set null). Sem o canônico, e como o raw_text é 'chicken thighs'
    // (não 'frango'), a busca pt-BR 'frango' não tem mais surface → OMITE R_cross. Prova
    // que foi o CANÔNICO (não o título 'Grilled thighs over coals') que produziu a linha no
    // caso positivo. (Nota: 'chicken' acha R_cross via degradação raw_text com config
    // recipe_ts_config(original_locale='en-US') — esperado; o canônico é o que carrega o
    // recall cross-locale a partir do termo pt-BR.)
    await sql`UPDATE recipe_ingredient SET ingredient_id = NULL WHERE recipe_id = ${m.R_cross}`
    const afterNull = await searchBody('frango', 'pt-BR')
    expect(allIds(afterNull)).not.toContain(m.R_cross)
  })

  it('AC2: overlap multi-termo — match=all exige TODOS; match=any qualquer', async () => {
    const m = await seedIngredientSearchMatrix()

    // 'all' de 3 termos: R_all (tem os três) entra; R_partial2 (frango+limao, SEM alho)
    // NÃO entra (overlap 2 ≠ 3).
    const all = await searchBody('frango,limão,alho', 'pt-BR', 'all')
    expect(allIds(all)).toContain(m.R_all)
    expect(allIds(all)).not.toContain(m.R_partial2)

    // 'any' dos mesmos 3 termos: AMBOS entram (R_partial2 satisfaz frango+limao).
    const any = await searchBody('frango,limão,alho', 'pt-BR', 'any')
    expect(allIds(any)).toContain(m.R_all)
    expect(allIds(any)).toContain(m.R_partial2)
  })

  it('AC3: degradação raw_text — manjericão acha R_raw (sem canônico, só raw_text)', async () => {
    const m = await seedIngredientSearchMatrix()

    // R_raw tem só um Item raw_text='manjericão fresco' (ingredient_id NULL): nenhum
    // canônico resolve 'manjericão' → só a degradação FTS sobre raw_text o traz.
    const body = await searchBody('manjericão', 'pt-BR')
    expect(ids(body.catalogo)).toContain(m.R_raw)
  })

  it('AC4: quantidade/unidade NUNCA são predicado — frango acha R_qty; 2.5/kg NÃO', async () => {
    const m = await seedIngredientSearchMatrix()

    // frango acha R_qty pelo canônico (apesar de quantidade='2.500'/unidade=kg).
    const byFrango = await searchBody('frango', 'pt-BR')
    expect(ids(byFrango.catalogo)).toContain(m.R_qty)

    // Defesa-em-profundidade: '2.5' e 'kg' NÃO trazem R_qty por ingrediente (rawText=NULL
    // garante que nem a degradação raw_text os rote). A aplicação PRIMÁRIA é o invariante
    // de code-review de que nenhum CTE referencia quantidade/unidade.
    const byNum = await searchBody('2.5', 'pt-BR')
    expect(allIds(byNum)).not.toContain(m.R_qty)
    const byKg = await searchBody('kg', 'pt-BR')
    expect(allIds(byKg)).not.toContain(m.R_qty)
  })

  it('AC5: fold hífen→espaço load-bearing — cebola roxa acha R_cebola via alias; cebola não; isolamento', async () => {
    const m = await seedIngredientSearchMatrix()

    // 'cebola roxa' (com espaço) resolve o canônico SÓ via fold hífen→espaço (nome
    // 'cebola-roxa' + alias ['cebola-roxa'] — nenhuma superfície igual a 'cebola roxa' sem
    // o replace('-',' ')). R_cebola é catálogo (owner NULL).
    const byCebolaRoxa = await searchBody('cebola roxa', 'pt-BR')
    expect(ids(byCebolaRoxa.catalogo)).toContain(m.R_cebola)

    // 'cebola' (token só) NÃO resolve o canônico (match EXATO de termo inteiro, não token
    // FTS) e R_cebola não tem 'cebola' em título/raw_text → NÃO trazida.
    const byCebola = await searchBody('cebola', 'pt-BR')
    expect(allIds(byCebola)).not.toContain(m.R_cebola)

    // Isolamento: R_cebolaDefeated (canônico 'cebolaroxa', sem hífen/espaço nem ponte) NÃO
    // é trazida por 'cebola roxa' — o fold só salva quem tem hífen/espaço. Juntos provam
    // que o match sobrevive SÓ via o alias/nome hifenizado e MORRE se o fold for removido.
    expect(allIds(byCebolaRoxa)).not.toContain(m.R_cebolaDefeated)
  })

  it('EXTRA sort-key primária: (overlap + title_match) — R_titleIng outranks R_titleOnly na mesma seção', async () => {
    const m = await seedIngredientSearchMatrix()

    // Query que casa 'alho': R_titleIng (overlap=1 + title=1 = 2) deve vir ANTES de
    // R_titleOnly (overlap=0 + title=1 = 1), INDEPENDENTE do ts_rank. Ambos catálogo
    // (owner NULL) → mesma seção 'catalogo'.
    const body = await searchBody('alho', 'pt-BR')
    const cat = ids(body.catalogo)
    expect(cat).toContain(m.R_titleIng)
    expect(cat).toContain(m.R_titleOnly)
    expect(cat.indexOf(m.R_titleIng)).toBeLessThan(cat.indexOf(m.R_titleOnly))
  })

  it('EXTRA all-vs-any (R_titleBoth): título NÃO supre termo de ingrediente faltante no all', async () => {
    const m = await seedIngredientSearchMatrix()

    // R_titleBoth: título 'Frango com limão na brasa' casa o ?q= inteiro 'frango,limão',
    // mas só UM Item ligado a frango (sem limão em Item/raw_text) → overlap=1, N=2.
    // 'all' EXCLUI (overlap 1 ≠ 2 — o título não preenche o termo faltante).
    const all = await searchBody('frango,limão', 'pt-BR', 'all')
    expect(allIds(all)).not.toContain(m.R_titleBoth)

    // 'any' INCLUI (título casa o ?q= inteiro OU overlap>=1).
    const any = await searchBody('frango,limão', 'pt-BR', 'any')
    expect(allIds(any)).toContain(m.R_titleBoth)
  })

  it('EXTRA dedup canônico↔raw_text (R_both): frango satisfeito por AMBOS conta UMA vez', async () => {
    const m = await seedIngredientSearchMatrix()

    // R_both: Item canônico frango E rawText='frango caipira' (frango por DOIS sinais) +
    // Item alho. Para 'frango,alho' em 'all': frango conta UMA vez (UNION + COUNT DISTINCT)
    // → overlap=2=N → INCLUÍDA exatamente uma vez. (UNION ALL + COUNT(*) contaria frango
    // duas vezes → overlap=3≠2 → R_both seria erroneamente excluída.)
    const all = await searchBody('frango,alho', 'pt-BR', 'all')
    const occurrences = allIds(all).filter((id) => id === m.R_both)
    expect(occurrences).toEqual([m.R_both])
  })

  it('EXTRA N=0 (q=",,,"): retorna neutro e não traz NENHUMA Receita com ingrediente', async () => {
    await seedIngredientSearchMatrix()

    // ',,,' NÃO é neutralizado pelo C0-sanitizer (vírgulas sobrevivem) → chega a
    // searchRecipes com terms=[]. O resultado vazio AQUI é dirigido pelo q: ',,,' não tem
    // word-char → tsquery de título vazio → zero linhas sob AMBOS os modes; o guard
    // effectiveMode='any' NÃO muda a saída observável neste caso. O guard é
    // belt-and-suspenders: preserva o invariante (hits de título da #6 sobrevivem ao N=0)
    // SE a simetria q↔terms algum dia divergir (ex.: um q com word-char mas terms=[]).
    const body = await searchBody(',,,', 'pt-BR', 'all')
    expect(body).toEqual({ catalogo: [], comunidade: [] })
  })

  it('EXTRA q patológico: handler trata graciosamente entrada gigante (smoke 200)', async () => {
    await seedIngredientSearchMatrix()

    // Smoke de handling gracioso, NÃO prova do cap: este input retorna 200 mesmo SEM os
    // caps (a prova do cap a MAX_TERMS é o unit de parseSearchTerms). Aqui só asseguramos
    // que um ?q= gigante não derruba o handler — corte a MAX_QUERY_LEN + dedup ('x'
    // colapsa a 1 termo) + cap mantêm a query bounded e a resposta 200 bem-formada.
    const res = await search('x,'.repeat(2000), 'pt-BR')
    expect(res.status).toBe(200)
    const body = (await res.json()) as SearchResponse
    expect(Array.isArray(body.catalogo)).toBe(true)
    expect(Array.isArray(body.comunidade)).toBe(true)
  })

  it('controle de gate: frango NUNCA traz R_playful nem R_private', async () => {
    const m = await seedIngredientSearchMatrix()

    const body = await searchBody('frango', 'pt-BR')
    const all = allIds(body)
    // R_playful (playful, private+dono) ⇒ barrada pelo gate E pela exclusão de playful.
    expect(all).not.toContain(m.R_playful)
    // R_private (private COM dono) ⇒ barrada pelo gate (owner NULL OR public).
    expect(all).not.toContain(m.R_private)
  })

  it('regressão #6: com fixtures sem ingredientes o resultado reduz à #6 (ramo de ingrediente vazio)', async () => {
    const m = await seedSearchMatrix()

    // seedSearchMatrix semeia ZERO ingredientes → o eixo de ingrediente fica vazio e o
    // resultado deve ser IDÊNTICO ao da #6: A no catálogo (gate owner-NULL); B/C na
    // comunidade; D/E ausentes; G (controle) ausente.
    const body = await searchBody('chili', 'pt-BR')
    expect(ids(body.catalogo)).toContain(m.A)
    expect(ids(body.comunidade)).toEqual(expect.arrayContaining([m.B, m.C]))
    const all = allIds(body)
    expect(all).not.toContain(m.D)
    expect(all).not.toContain(m.E)
    expect(ids(body.catalogo)).not.toContain(m.G)
  })

  it('invariante NUNCA cria: count(recipe) inalterado antes/depois da busca', async () => {
    await seedIngredientSearchMatrix()

    const before = (await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM recipe`)[0]
      .count
    await searchBody('frango,limão,alho', 'pt-BR', 'all')
    await searchBody('manjericão', 'pt-BR')
    await searchBody('cebola roxa', 'pt-BR')
    const after = (await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM recipe`)[0]
      .count
    expect(after).toBe(before)
  })
})
