import { getDb } from '@/server/deps'
import {
  recipe,
  recipeTranslation,
  ingredient,
  ingredientTranslation,
  recipeIngredient,
  tag,
  recipeTag,
  recipeEmbedding,
} from '@/db/schema'
import type { Cozinha, Categoria, Restricao, Unidade } from '@/domain/vocabulary'
import type { Origin, Visibility, ResultKind, LineageKind, TranslationProvenance } from '@/domain/recipe'

/**
 * Fábricas de seed da Receita (issue #3). Inserem PAIS antes de filhos e devolvem
 * os uuids RETORNADOS (PKs não-determinísticos — testes asseguram por id retornado,
 * nunca por serial). `quantidade` é numeric(10,3) e trafega SEMPRE como string
 * literal (lê de volta como string em escala-3, ex. '2.500') — nunca number.
 *
 * `alergenos` (em ingredient) e `nota` (em recipe_ingredient) são colunas DORMENTES:
 * settáveis aqui, sem comportamento de leitura na #3.
 */

// ── Fábricas atômicas ───────────────────────────────────────────────────────────

export async function seedRecipe(input: {
  origin: Origin
  originalLocale: string
  visibility?: Visibility
  resultKind?: ResultKind
  ownerId?: string | null
  cozinha?: Cozinha | null
  categoria?: Categoria | null
  restricoes?: Restricao[]
  porcoes?: number | null
  dificuldade?: number | null
  parentRecipeId?: string | null
  lineageKind?: LineageKind | null
  schemaVersion?: number
}): Promise<string> {
  const [row] = await getDb()
    .insert(recipe)
    .values({
      origin: input.origin,
      originalLocale: input.originalLocale,
      visibility: input.visibility,
      resultKind: input.resultKind,
      ownerId: input.ownerId ?? null,
      cozinha: input.cozinha ?? null,
      categoria: input.categoria ?? null,
      restricoes: input.restricoes,
      porcoes: input.porcoes ?? null,
      dificuldade: input.dificuldade ?? null,
      parentRecipeId: input.parentRecipeId ?? null,
      lineageKind: input.lineageKind ?? null,
      schemaVersion: input.schemaVersion,
    })
    .returning({ id: recipe.id })
  return row.id
}

export async function seedTranslation(input: {
  recipeId: string
  locale: string
  titulo: string
  provenance: TranslationProvenance
  descricao?: string | null
  passos?: string[] | null
  notas?: string | null
  stale?: boolean
}): Promise<string> {
  const [row] = await getDb()
    .insert(recipeTranslation)
    .values({
      recipeId: input.recipeId,
      locale: input.locale,
      titulo: input.titulo,
      provenance: input.provenance,
      descricao: input.descricao ?? null,
      passos: input.passos ?? null,
      notas: input.notas ?? null,
      stale: input.stale,
    })
    .returning({ id: recipeTranslation.id })
  return row.id
}

export async function seedIngredient(input: {
  slug?: string | null
  alergenos?: string[]
} = {}): Promise<string> {
  const [row] = await getDb()
    .insert(ingredient)
    .values({
      slug: input.slug ?? null,
      alergenos: input.alergenos ?? null,
    })
    .returning({ id: ingredient.id })
  return row.id
}

export async function seedIngredientTranslation(input: {
  ingredientId: string
  locale: string
  nome: string
  aliases?: string[] | null
}): Promise<string> {
  const [row] = await getDb()
    .insert(ingredientTranslation)
    .values({
      ingredientId: input.ingredientId,
      locale: input.locale,
      nome: input.nome,
      aliases: input.aliases ?? null,
    })
    .returning({ id: ingredientTranslation.id })
  return row.id
}

export async function seedRecipeIngredient(input: {
  recipeId: string
  ingredientId?: string | null
  ordem?: number
  quantidade?: string | null
  unidade?: Unidade | null
  rawText?: string | null
  nota?: string | null
}): Promise<string> {
  const [row] = await getDb()
    .insert(recipeIngredient)
    .values({
      recipeId: input.recipeId,
      ingredientId: input.ingredientId ?? null,
      ordem: input.ordem,
      quantidade: input.quantidade ?? null,
      unidade: input.unidade ?? null,
      rawText: input.rawText ?? null,
      nota: input.nota ?? null,
    })
    .returning({ id: recipeIngredient.id })
  return row.id
}

/** Normaliza nome (lowercase + trim) e devolve o uuid. Tag é única por nome. */
export async function seedTag(nome: string): Promise<string> {
  const [row] = await getDb()
    .insert(tag)
    .values({ nome: nome.toLowerCase().trim() })
    .returning({ id: tag.id })
  return row.id
}

export async function linkRecipeTag(recipeId: string, tagId: string): Promise<void> {
  await getDb().insert(recipeTag).values({ recipeId, tagId })
}

/** Linha de embedding DORMENTE: embedding fica NULL na #3. */
export async function seedEmbedding(input: {
  recipeId: string
  locale: string
  model?: string | null
  stale?: boolean
}): Promise<void> {
  await getDb()
    .insert(recipeEmbedding)
    .values({
      recipeId: input.recipeId,
      locale: input.locale,
      embedding: null,
      model: input.model ?? null,
      stale: input.stale,
    })
}

// ── Catálogo composto: Feijoada (origin catalog) ────────────────────────────────

export type FeijoadaIds = {
  recipeId: string
  tituloPt: string
  tituloEn: string
  descricaoPt: string
  passosPt: string[]
  notasPt: string
}

/**
 * Catálogo Feijoada: origin=catalog, ownerId NULL, originalLocale pt-BR, cozinha
 * brasileira, categoria prato_principal, restricoes não-vazia válida, porcoes 6,
 * dificuldade 3, schemaVersion no default.
 *  - pt-BR: tradução COMPLETA, provenance escrita_por_pessoa.
 *  - en-US: PARCIAL (descricao/passos NULL → fallback p/ pt-BR), provenance
 *    automatica_revisada (confiável), titulo DIFERENTE do pt → dispara parênteses (AC#1).
 *  - recipe_ingredient: quantidade string + unidade enum; uma linha 'a gosto'/a_gosto.
 *  - recipe_embedding pt-BR + en-US, embedding NULL.
 */
export async function seedFeijoadaCatalog(): Promise<FeijoadaIds> {
  const tituloPt = 'Feijoada'
  const tituloEn = 'Brazilian Black Bean Stew'
  const descricaoPt = 'Ensopado de feijão-preto com cortes de porco.'
  const passosPt = ['Deixe o feijão de molho.', 'Cozinhe as carnes.', 'Junte tudo e apure.']
  const notasPt = 'Sirva com arroz, couve e laranja.'

  const recipeId = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    ownerId: null,
    cozinha: 'brasileira',
    categoria: 'prato_principal',
    restricoes: ['sem_gluten', 'sem_lactose'],
    porcoes: 6,
    dificuldade: 3,
  })

  await seedTranslation({
    recipeId,
    locale: 'pt-BR',
    titulo: tituloPt,
    descricao: descricaoPt,
    passos: passosPt,
    notas: notasPt,
    provenance: 'escrita_por_pessoa',
  })

  // en-US PARCIAL: descricao/passos NULL → caem para pt-BR; titulo difere → parênteses.
  await seedTranslation({
    recipeId,
    locale: 'en-US',
    titulo: tituloEn,
    descricao: null,
    passos: null,
    notas: 'Serve with rice, collard greens and orange.',
    provenance: 'automatica_revisada',
  })

  const feijao = await seedIngredient({ slug: 'feijao-preto' })
  const sal = await seedIngredient({ slug: 'sal' })
  await seedIngredientTranslation({ ingredientId: feijao, locale: 'pt-BR', nome: 'feijão-preto' })
  await seedIngredientTranslation({ ingredientId: feijao, locale: 'en-US', nome: 'black beans' })
  await seedIngredientTranslation({ ingredientId: sal, locale: 'pt-BR', nome: 'sal' })
  await seedIngredientTranslation({ ingredientId: sal, locale: 'en-US', nome: 'salt' })

  await seedRecipeIngredient({
    recipeId,
    ingredientId: feijao,
    ordem: 0,
    quantidade: '2.500',
    unidade: 'kg',
  })
  await seedRecipeIngredient({
    recipeId,
    ingredientId: sal,
    ordem: 1,
    quantidade: null,
    unidade: 'a_gosto',
    rawText: 'a gosto',
  })

  await seedEmbedding({ recipeId, locale: 'pt-BR' })
  await seedEmbedding({ recipeId, locale: 'en-US' })

  return { recipeId, tituloPt, tituloEn, descricaoPt, passosPt, notasPt }
}

/**
 * Receita cujos itens são INSERIDOS fora de ordem (ordem 2 → 0 → 1) para provar que
 * a leitura ordena por `ordem`, não pela ordem de inserção/PK. Mínima de propósito.
 */
export async function seedRecipeUnorderedIngredients(): Promise<{ recipeId: string }> {
  const recipeId = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    porcoes: 2,
    dificuldade: 1,
  })

  await seedTranslation({
    recipeId,
    locale: 'pt-BR',
    titulo: 'Salada simples',
    provenance: 'escrita_por_pessoa',
  })

  // Inserção deliberadamente embaralhada: 2, depois 0, depois 1.
  await seedRecipeIngredient({ recipeId, ordem: 2, quantidade: '3.000', unidade: 'unidade' })
  await seedRecipeIngredient({ recipeId, ordem: 0, quantidade: '1.000', unidade: 'unidade' })
  await seedRecipeIngredient({ recipeId, ordem: 1, quantidade: '2.000', unidade: 'unidade' })

  return { recipeId }
}

/**
 * Receita SEM restrição: restricoes=[] (casa com o default notNull '{}', NUNCA NULL)
 * para AC#3. Mantém cozinha/categoria/tags presentes; só restricoes fica vazio.
 */
export async function seedRecipeNoRestriction(): Promise<{ recipeId: string }> {
  const recipeId = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    cozinha: 'italiana',
    categoria: 'sobremesa',
    restricoes: [],
    porcoes: 4,
    dificuldade: 2,
  })

  await seedTranslation({
    recipeId,
    locale: 'pt-BR',
    titulo: 'Tiramisù',
    descricao: 'Doce italiano em camadas.',
    passos: ['Monte as camadas.', 'Leve à geladeira.'],
    provenance: 'escrita_por_pessoa',
  })

  const tagId = await seedTag('  Clássico  ')
  await linkRecipeTag(recipeId, tagId)

  return { recipeId }
}
