import { describe, it, expect } from 'vitest'
import { GET as recipeGet } from '@/app/api/recipes/[id]/route'
import { POST as publishRoute } from '@/app/api/recipes/[id]/publish/route'
import { seedSessionHeaders } from '../helpers/users'
import {
  seedRecipe,
  seedTranslation,
  seedIngredient,
  seedRecipeIngredient,
} from '../helpers/recipes'

/**
 * Aviso de restrição na leitura localizada da Receita pela porta mais alta — handler
 * GET (issue #7). O Aviso é leve e honesto: dispara SÓ quando o dado oportunista de
 * alérgeno flagra uma CONTRADIÇÃO óbvia contra uma restrição declarada; NUNCA bloqueia/
 * suprime/gateia nada; ausência de dado nunca vira falso alarme nem falso "tudo certo";
 * renderizado POR LOCALE (mesma substância, texto traduzido — ADR-0001/ADR-0004).
 *
 * `setup.ts` aponta o DI para o Postgres descartável e trunca antes de cada teste.
 * Modelo de invocação (porta alta com Request cru + params Promise) copiado de
 * recipes-get.test.ts / recipes-publish.test.ts.
 *
 * NB (TDD): estes casos são escritos CONTRA o contrato GET de #7 (RecipeView.avisos?).
 * As fatias de produção (motor puro, costura de display no loader/vista, i18n en-US)
 * aterrissam em paralelo; o gate verde final reconcilia. Não esperar que TODOS passem
 * agora.
 */

/** Lê a Receita pela porta alta (GET da #3). Sem headers = leitura ANÔNIMA (terceiro). */
function get(id: string, headers?: Headers, locale?: string): Promise<Response> {
  const qs = locale ? `?locale=${encodeURIComponent(locale)}` : ''
  return recipeGet(new Request(`http://localhost/api/recipes/${id}${qs}`, { headers }), {
    params: Promise.resolve({ id }),
  })
}

/** Publica pela porta alta (POST da #13) — usado só no cross-check "nunca bloqueia publish". */
function publish(id: string, headers?: Headers): Promise<Response> {
  return publishRoute(new Request(`http://localhost/api/recipes/${id}/publish`, { method: 'POST', headers }), {
    params: Promise.resolve({ id }),
  })
}

/** Shape parcial da view relevante ao Aviso (o resto do contrato é coberto em recipes-get). */
type AvisoView = {
  kind: 'contradicao'
  restricao: string
  alergeno: string
  mensagem: string
}
type RecipeView = {
  id: string
  origin: string
  avisos?: AvisoView[]
  facets: Record<string, unknown>
  ingredients: Array<Record<string, unknown>>
}

/**
 * Semeia uma Receita + 1 tradução pt-BR + 1 ingredient FK (com `alergenos`) ligado por
 * recipe_ingredient. Açúcar local (não é helper FALTANTE — compõe os atômicos do §6 do
 * plano). Devolve o id da Receita.
 */
async function seedRecipeWithFkAllergen(input: {
  restricoes: string[]
  alergenos: string[] | null
  origin?: 'catalog' | 'ai_chat'
  ownerId?: string | null
  visibility?: 'private' | 'public'
  resultKind?: 'success' | 'degraded' | 'playful'
}): Promise<string> {
  const id = await seedRecipe({
    origin: input.origin ?? 'catalog',
    originalLocale: 'pt-BR',
    ownerId: input.ownerId ?? null,
    visibility: input.visibility,
    resultKind: input.resultKind ?? 'success',
    restricoes: input.restricoes as never,
  })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })
  const ingredientId = await seedIngredient(
    input.alergenos === null ? { slug: null } : { slug: null, alergenos: input.alergenos },
  )
  await seedRecipeIngredient({ recipeId: id, ingredientId, ordem: 0, quantidade: '1.000', unidade: 'unidade' })
  return id
}

describe('GET /api/recipes/[id] — Aviso de restrição (#7)', () => {
  // I1 — contradição canônica trigo×sem_gluten: 200, receita COMPLETA, avisos PRESENTE
  // com a frase usando o RÓTULO amigável (não o código cru) e o token de alérgeno cru.
  it('I1: sem_gluten + item FK com alergenos ["trigo"] (pt-BR) ⇒ 200, avisos com contradicao e mensagem com rótulo', async () => {
    const id = await seedRecipeWithFkAllergen({ restricoes: ['sem_gluten'], alergenos: ['trigo'] })

    const res = await get(id, undefined, 'pt-BR')
    // NÃO é bloqueado/suprimido/404: a receita completa volta normalmente.
    expect(res.status).toBe(200)
    const view = (await res.json()) as RecipeView
    expect(view.id).toBe(id)

    // avisos PRESENTE, exatamente 1 entrada, com os códigos do domínio.
    expect(view.avisos).toBeDefined()
    expect(view.avisos).toHaveLength(1)
    const aviso = view.avisos![0]
    expect(aviso.kind).toBe('contradicao')
    expect(aviso.restricao).toBe('sem_gluten')
    expect(aviso.alergeno).toBe('trigo')

    // (a) mensagem PRESENTE e lê com o RÓTULO amigável ("sem glúten"), NÃO o código cru.
    expect(aviso.mensagem).toContain('sem glúten')
    expect(aviso.mensagem).not.toContain('sem_gluten')
    // (c) a frase foi REALMENTE interpolada (não restou o placeholder = sem fallback de chave-faltante).
    expect(aviso.mensagem).not.toContain('{restricao}')
    expect(aviso.mensagem).not.toContain('{alergeno}')
    expect(aviso.mensagem).toContain('trigo')
  })

  // I2 — mesma Receita em pt-BR vs en-US: a mensagem DIFERE byte-a-byte, mas os CÓDIGOS
  // (kind/restricao/alergeno) são IDÊNTICOS — mesma substância, traduzida (ADR-0001).
  it('I2: mesma contradição em pt-BR vs en-US ⇒ mensagem difere em bytes, códigos idênticos', async () => {
    const id = await seedRecipeWithFkAllergen({ restricoes: ['sem_gluten'], alergenos: ['trigo'] })

    const ptRes = await get(id, undefined, 'pt-BR')
    const enRes = await get(id, undefined, 'en-US')
    expect(ptRes.status).toBe(200)
    expect(enRes.status).toBe(200)
    const pt = (await ptRes.json()) as RecipeView
    const en = (await enRes.json()) as RecipeView

    expect(pt.avisos).toHaveLength(1)
    expect(en.avisos).toHaveLength(1)
    const ptAviso = pt.avisos![0]
    const enAviso = en.avisos![0]

    // CÓDIGOS idênticos entre locales.
    expect(enAviso.kind).toBe(ptAviso.kind)
    expect(enAviso.restricao).toBe(ptAviso.restricao)
    expect(enAviso.alergeno).toBe(ptAviso.alergeno)

    // mensagem traduzida: bytes DIFERENTES, e a en-US lê com o rótulo en ("gluten-free"),
    // não o código cru — prova de render localizado, não byte-idêntico.
    expect(enAviso.mensagem).not.toBe(ptAviso.mensagem)
    expect(enAviso.mensagem).toContain('gluten-free')
    expect(enAviso.mensagem).not.toContain('sem_gluten')
    expect(enAviso.mensagem).not.toContain('{restricao}')
    expect(enAviso.mensagem).not.toContain('{alergeno}')
  })

  // I3a — restrição declarada mas alérgeno CONSISTENTE (não contradiz): avisos AUSENTE.
  it('I3a: sem_gluten + item FK com alergenos ["leite"] (consistente) ⇒ avisos AUSENTE', async () => {
    const id = await seedRecipeWithFkAllergen({ restricoes: ['sem_gluten'], alergenos: ['leite'] })

    const res = await get(id, undefined, 'pt-BR')
    expect(res.status).toBe(200)
    const view = (await res.json()) as RecipeView
    // ausente ≠ vazio: a chave não pode sobreviver à serialização quando não há contradição.
    expect(view).not.toHaveProperty('avisos')
  })

  // I3b — alérgeno SEM entrada no mapa: nunca dispara (só dispara em match do mapa).
  it('I3b: sem_gluten + item FK com alergenos ["corante"] (fora do mapa) ⇒ avisos AUSENTE', async () => {
    const id = await seedRecipeWithFkAllergen({ restricoes: ['sem_gluten'], alergenos: ['corante'] })

    const res = await get(id, undefined, 'pt-BR')
    expect(res.status).toBe(200)
    const view = (await res.json()) as RecipeView
    expect(view).not.toHaveProperty('avisos')
  })

  // I4 — raw-text-only (ingredient_id NULL): ausência de dado NUNCA dispara; itens FLUEM (LEFT JOIN).
  it('I4: restrições mas TODOS itens raw-text-only (FK null) ⇒ avisos AUSENTE; itens fluem', async () => {
    const id = await seedRecipe({
      origin: 'catalog',
      originalLocale: 'pt-BR',
      restricoes: ['sem_gluten'] as never,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })
    // Dois itens raw-text-only: sem ingredientId (→ FK null), só rawText.
    await seedRecipeIngredient({ recipeId: id, ordem: 0, rawText: '2 xícaras de farinha de trigo' })
    await seedRecipeIngredient({ recipeId: id, ordem: 1, rawText: 'açúcar a gosto' })

    const res = await get(id, undefined, 'pt-BR')
    expect(res.status).toBe(200)
    const view = (await res.json()) as RecipeView
    expect(view).not.toHaveProperty('avisos')
    // LEFT JOIN: os itens raw-text-only não são derrubados.
    expect(view.ingredients).toHaveLength(2)
  })

  // I5 — FK porém alergenos NULL (sem dado): ausência nunca dispara nem falso all-clear.
  it('I5: item FK com alergenos NULL + sem_gluten ⇒ avisos AUSENTE', async () => {
    const id = await seedRecipeWithFkAllergen({ restricoes: ['sem_gluten'], alergenos: null })

    const res = await get(id, undefined, 'pt-BR')
    expect(res.status).toBe(200)
    const view = (await res.json()) as RecipeView
    expect(view).not.toHaveProperty('avisos')
  })

  // I5b — FK com alergenos [] (dado explicitamente vazio): declarado fica não-verificado, sem aviso.
  it('I5b: item FK com alergenos [] + sem_gluten ⇒ avisos AUSENTE', async () => {
    const id = await seedRecipeWithFkAllergen({ restricoes: ['sem_gluten'], alergenos: [] })

    const res = await get(id, undefined, 'pt-BR')
    expect(res.status).toBe(200)
    const view = (await res.json()) as RecipeView
    expect(view).not.toHaveProperty('avisos')
  })

  // I6 — sem restrição declarada: nada a contradizer; avisos AUSENTE e facets.restricoes
  // também AUSENTE (sanity do precedente "ausente ≠ vazio").
  it('I6: restrições=[] + item FK com alergenos ["trigo"] ⇒ avisos AUSENTE; facets.restricoes AUSENTE', async () => {
    const id = await seedRecipeWithFkAllergen({ restricoes: [], alergenos: ['trigo'] })

    const res = await get(id, undefined, 'pt-BR')
    expect(res.status).toBe(200)
    const view = (await res.json()) as RecipeView
    expect(view).not.toHaveProperty('avisos')
    expect(view.facets).not.toHaveProperty('restricoes')
  })

  // I7 — não-vazamento: view.ingredients NÃO carrega a chave `alergenos` (IngredientView
  // Omit). Mesmo invariante de chaves de recipes-get.test.ts:47.
  it('I7: view.ingredients[0] NÃO contém `alergenos` (chaves exatas do contrato)', async () => {
    const id = await seedRecipeWithFkAllergen({ restricoes: ['sem_gluten'], alergenos: ['trigo'] })

    const res = await get(id, undefined, 'pt-BR')
    expect(res.status).toBe(200)
    const view = (await res.json()) as RecipeView
    expect(view.ingredients.length).toBeGreaterThan(0)
    expect(view.ingredients[0]).not.toHaveProperty('alergenos')
    expect(Object.keys(view.ingredients[0]).sort()).toEqual(['ordem', 'quantidade', 'rawText', 'unidade'])
  })

  // I8 — dedup ponta-a-ponta: dois itens FK ambos ["trigo"] + sem_gluten ⇒ UMA entrada.
  it('I8: dois itens FK ["trigo"] + sem_gluten ⇒ avisos com 1 entrada (dedup por restrição)', async () => {
    const id = await seedRecipe({
      origin: 'catalog',
      originalLocale: 'pt-BR',
      restricoes: ['sem_gluten'] as never,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })
    const ing0 = await seedIngredient({ slug: 'farinha', alergenos: ['trigo'] })
    const ing1 = await seedIngredient({ slug: 'farinha-de-rosca', alergenos: ['trigo'] })
    await seedRecipeIngredient({ recipeId: id, ingredientId: ing0, ordem: 0, quantidade: '1.000', unidade: 'unidade' })
    await seedRecipeIngredient({ recipeId: id, ingredientId: ing1, ordem: 1, quantidade: '1.000', unidade: 'unidade' })

    const res = await get(id, undefined, 'pt-BR')
    expect(res.status).toBe(200)
    const view = (await res.json()) as RecipeView
    expect(view.avisos).toHaveLength(1)
    expect(view.avisos![0].restricao).toBe('sem_gluten')
  })

  // I8b — múltiplas restrições, cada uma avaliada INDEPENDENTEMENTE. Laticínio (leite)
  // contradiz sem_lactose E vegano (NÃO vegetariano — ovolacto aceita laticínio, D1).
  it('I8b: restrições [sem_lactose, vegano, vegetariano] + item ["leite"] ⇒ 2 avisos (lactose+vegano), não vegetariano', async () => {
    const id = await seedRecipeWithFkAllergen({
      restricoes: ['sem_lactose', 'vegano', 'vegetariano'],
      alergenos: ['leite'],
    })

    const res = await get(id, undefined, 'pt-BR')
    expect(res.status).toBe(200)
    const view = (await res.json()) as RecipeView
    expect(view.avisos).toHaveLength(2)
    const restricoes = view.avisos!.map((a) => a.restricao).sort()
    expect(restricoes).toEqual(['sem_lactose', 'vegano'])
    // vegetariano NÃO dispara (guarda contra falso alarme).
    expect(restricoes).not.toContain('vegetariano')
  })

  // I9 — regra IDÊNTICA catálogo vs comunidade. Catálogo (ownerId null) e comunidade
  // (origin ai_chat, ownerId, visibility public) com a MESMA contradição produzem o MESMO aviso.
  it('I9: catálogo (ownerId null) vs comunidade (ai_chat, public) ⇒ aviso idêntico', async () => {
    const catalogId = await seedRecipeWithFkAllergen({
      restricoes: ['sem_gluten'],
      alergenos: ['trigo'],
      origin: 'catalog',
      ownerId: null,
      visibility: 'public',
    })
    const { userId } = await seedSessionHeaders({ email: 'community-aviso@ex.com' })
    const communityId = await seedRecipeWithFkAllergen({
      restricoes: ['sem_gluten'],
      alergenos: ['trigo'],
      origin: 'ai_chat',
      ownerId: userId,
      visibility: 'public',
    })

    const catView = (await (await get(catalogId, undefined, 'pt-BR')).json()) as RecipeView
    const comView = (await (await get(communityId, undefined, 'pt-BR')).json()) as RecipeView

    expect(catView.avisos).toHaveLength(1)
    expect(comView.avisos).toHaveLength(1)
    // Códigos + mensagem idênticos (mesmo locale): a regra de exibição não olha proveniência.
    const strip = (a: AvisoView) => ({ kind: a.kind, restricao: a.restricao, alergeno: a.alergeno, mensagem: a.mensagem })
    expect(strip(comView.avisos![0])).toEqual(strip(catView.avisos![0]))
  })

  // I10 — NUNCA bloqueia publish: uma Receita carregando contradição PUBLICA normalmente
  // (publish gateado SÓ por playful). Após publicar, o GET ainda traz o aviso.
  it('I10: Receita success com contradição publica normalmente (200, public); GET ainda traz aviso', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'owner-aviso-publish@ex.com' })
    const id = await seedRecipeWithFkAllergen({
      restricoes: ['sem_gluten'],
      alergenos: ['trigo'],
      origin: 'ai_chat',
      ownerId: userId,
      visibility: 'private',
      resultKind: 'success',
    })

    const pub = await publish(id, headers)
    // O Aviso NÃO gateia: publish sucede (gateado só por playful).
    expect(pub.status).toBe(200)
    const pubView = (await pub.json()) as RecipeView
    expect(pubView.id).toBe(id)

    // Leitura anônima da pública (entrou no pool) ainda carrega o aviso.
    const res = await get(id, undefined, 'pt-BR')
    expect(res.status).toBe(200)
    const view = (await res.json()) as RecipeView
    expect(view.avisos).toHaveLength(1)
    expect(view.avisos![0].restricao).toBe('sem_gluten')
  })

  // I11 — ordem dos itens preservada com o LEFT JOIN (não reordena nem infla linhas).
  it('I11: ordem dos itens preservada com JOIN ⇒ [0,1,2]', async () => {
    const id = await seedRecipe({
      origin: 'catalog',
      originalLocale: 'pt-BR',
      restricoes: ['sem_gluten'] as never,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Salada', provenance: 'escrita_por_pessoa' })
    const ing = await seedIngredient({ slug: 'farinha', alergenos: ['trigo'] })
    // Inserção embaralhada (2,0,1) + mistura FK/raw-text; a leitura deve ordenar por `ordem`.
    await seedRecipeIngredient({ recipeId: id, ordem: 2, quantidade: '3.000', unidade: 'unidade' })
    await seedRecipeIngredient({ recipeId: id, ingredientId: ing, ordem: 0, quantidade: '1.000', unidade: 'unidade' })
    await seedRecipeIngredient({ recipeId: id, ordem: 1, quantidade: '2.000', unidade: 'unidade' })

    const res = await get(id, undefined, 'pt-BR')
    expect(res.status).toBe(200)
    const view = (await res.json()) as RecipeView & { ingredients: Array<{ ordem: number }> }
    expect(view.ingredients.map((i) => i.ordem)).toEqual([0, 1, 2])
  })

  // I12 — visitante ANÔNIMO lê uma pública com contradição ⇒ aviso PRESENTE (a regra não
  // depende de sessão; é leitura pública, terceiro mais forte = sem sessão).
  it('I12: visitante anônimo lê pública com contradição ⇒ avisos presente', async () => {
    const id = await seedRecipeWithFkAllergen({
      restricoes: ['sem_gluten'],
      alergenos: ['trigo'],
      origin: 'catalog',
      ownerId: null,
      visibility: 'public',
    })

    // get() sem headers = leitura anônima.
    const res = await get(id, undefined, 'pt-BR')
    expect(res.status).toBe(200)
    const view = (await res.json()) as RecipeView
    expect(view.avisos).toHaveLength(1)
    expect(view.avisos![0].alergeno).toBe('trigo')
  })
})
