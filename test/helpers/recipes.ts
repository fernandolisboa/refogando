import { eq } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import {
  recipe,
  recipeTranslation,
  recipeImage,
  recipeReview,
  ingredient,
  ingredientTranslation,
  recipeIngredient,
  tag,
  recipeTag,
  recipeEmbedding,
  recipeSave,
  collection,
  collectionItem,
  report,
} from '@/db/schema'
import type { Cozinha, Categoria, Restricao, Unidade } from '@/domain/vocabulary'
import type { Origin, Visibility, ResultKind, LineageKind, TranslationProvenance, ImageProvenance } from '@/domain/recipe'
import type { DerivedDiff } from '@/domain/recipe-diff'
import type { ReportStatus } from '@/domain/report'
import type { CurationStatus } from '@/domain/recipe-curation'
import { seedUser } from './users'

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
  id?: string // pino opcional do PK (default defaultRandom); usado p/ ordenar tiebreaks deterministicamente
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
  tempoAtivoMin?: number | null
  tempoTotalMin?: number | null
  parentRecipeId?: string | null
  lineageKind?: LineageKind | null
  // Diff DERIVADO congelado (#17): JSONB nullable, settável para semear uma DERIVADA já forkada
  // (assim #21/#61 testam leitura/exibição de uma derivada existente sem chamar a rota). A coluna
  // é `$type<DerivedDiff>` — o seed aceita a forma congelada do domínio.
  derivedDiff?: DerivedDiff | null
  schemaVersion?: number
  // #238/ADR-0026: estado de curadoria. DEFAULT inteligente que espelha o backfill de prod —
  // catálogo (owner-null) nasce `approved` (visível, como o catálogo legado pós-migração), receita
  // de usuário nasce `not_required`. Override explícito p/ semear rascunho pending/editing/rejected
  // (ex.: o teste de não-vazamento). Sem isto, toda fixture de catálogo cairia no default
  // 'not_required' da coluna ⇒ invisível ⇒ ~dezenas de testes de catálogo quebrariam.
  curationStatus?: CurationStatus
}): Promise<string> {
  const ownerIsNull = (input.ownerId ?? null) == null
  const [row] = await getDb()
    .insert(recipe)
    .values({
      ...(input.id !== undefined ? { id: input.id } : {}),
      origin: input.origin,
      originalLocale: input.originalLocale,
      visibility: input.visibility,
      resultKind: input.resultKind,
      ownerId: input.ownerId ?? null,
      curationStatus: input.curationStatus ?? (ownerIsNull ? 'approved' : 'not_required'),
      cozinha: input.cozinha ?? null,
      categoria: input.categoria ?? null,
      restricoes: input.restricoes,
      porcoes: input.porcoes ?? null,
      dificuldade: input.dificuldade ?? null,
      tempoAtivoMin: input.tempoAtivoMin ?? null,
      tempoTotalMin: input.tempoTotalMin ?? null,
      parentRecipeId: input.parentRecipeId ?? null,
      lineageKind: input.lineageKind ?? null,
      derivedDiff: input.derivedDiff ?? null,
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
  // Slug per-locale (#229/#230): opcional — ausente ⇒ NULL (a coluna nasce nullable; o slug é
  // materializado por freezeSlug na borda). Settável aqui p/ semear a URL canônica nos testes
  // de leitura por slug e do redirect (308) do uuid legado.
  slug?: string | null
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
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
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

/**
 * Linha de embedding. Default DORMENTE (embedding NULL, como nasce na #3); #14 passa
 * `embedding` (1536-dim) para semear a camada semântica. O vetor DEVE ter 1536 dims
 * (casar `vector(1536)`), senão o Postgres rejeita (`expected 1536 dimensions, not N`).
 */
export async function seedEmbedding(input: {
  recipeId: string
  locale: string
  embedding?: number[] | null
  model?: string | null
  stale?: boolean
}): Promise<void> {
  await getDb()
    .insert(recipeEmbedding)
    .values({
      recipeId: input.recipeId,
      locale: input.locale,
      embedding: input.embedding ?? null,
      model: input.model ?? null,
      stale: input.stale,
    })
}

// ── Social: Salvar (issue #16/#362) ─────────────────────────────────────────────

/**
 * Insere uma linha de save crua (issue #16/#362). O `userId` DEVE ser um id REAL de Usuário
 * (ex. o devolvido por `seedSessionHeaders`/`seedUser`) — a FK p/ users.id é validada.
 * Idempotente por PK composta; não usa ON CONFLICT (o seed assume linha nova).
 */
export async function seedSave(input: { userId: string; recipeId: string }): Promise<void> {
  await getDb().insert(recipeSave).values({ userId: input.userId, recipeId: input.recipeId })
}

// ── Coleções: pastas privadas M:N sobre o Salvar (issue #364) ────────────────────

/**
 * Insere uma Coleção crua (#364) e devolve o uuid retornado. `userId` DEVE ser id REAL de
 * Usuário (FK validada). `name` é único por (user_id, name) — o caller garante nomes distintos.
 */
export async function seedCollection(input: { userId: string; name: string }): Promise<string> {
  const [row] = await getDb()
    .insert(collection)
    .values({ userId: input.userId, name: input.name })
    .returning({ id: collection.id })
  return row.id
}

/**
 * Insere uma aresta collection_item crua (#364). NÃO garante o invariante `⊆ saves` (o teste que
 * precisar dele deve semear o `seedSave` correspondente) — é uma fábrica atômica, como `seedSave`.
 * Idempotente por PK composta; assume linha nova (sem ON CONFLICT).
 */
export async function seedCollectionItem(input: {
  collectionId: string
  recipeId: string
}): Promise<void> {
  await getDb()
    .insert(collectionItem)
    .values({ collectionId: input.collectionId, recipeId: input.recipeId })
}

// ── Moderação reativa: Report + remoção do pool (issue #18) ─────────────────────

/**
 * Insere uma linha de Report crua (issue #18/#366). `reporterId` DEVE ser um id REAL de
 * Usuário (FK validada). O alvo é EXATAMENTE UM: `recipeId` (receita) OU `reviewId` (avaliação) —
 * o CHECK `report_target_chk` rejeita ambos/nenhum. Default status='pending' (entra na fila).
 * Devolve o report id.
 */
export async function seedReport(input: {
  recipeId?: string | null
  reviewId?: string | null
  reporterId: string
  reason?: string
  status?: ReportStatus
}): Promise<string> {
  const [row] = await getDb()
    .insert(report)
    .values({
      recipeId: input.recipeId ?? null,
      reviewId: input.reviewId ?? null,
      reporterId: input.reporterId,
      reason: input.reason ?? 'motivo de teste',
      status: input.status,
    })
    .returning({ id: report.id })
  return row.id
}

/**
 * Insere uma Avaliação crua (issue #363/#366) e devolve o id. `userId`/`recipeId` DEVEM ser ids REAIS
 * (FKs validadas; UNIQUE por par). `moderated` semeia a avaliação JÁ moderada (#366), respeitando o
 * CHECK `recipe_review_moderation_consistency_chk` (seta `moderated_at` E `moderated_by` juntos);
 * `curatorId` deve ser id real. Mirror de `seedRecipeImage`.
 */
export async function seedReview(input: {
  userId: string
  recipeId: string
  rating: number
  comment?: string | null
  moderated?: { curatorId: string; reason?: string }
}): Promise<string> {
  const [row] = await getDb()
    .insert(recipeReview)
    .values({
      userId: input.userId,
      recipeId: input.recipeId,
      rating: input.rating,
      comment: input.comment ?? null,
      ...(input.moderated
        ? {
            moderatedAt: new Date(),
            moderatedReason: input.moderated.reason ?? 'avaliação moderada em teste',
            moderatedBy: input.moderated.curatorId,
          }
        : {}),
    })
    .returning({ id: recipeReview.id })
  return row.id
}

/**
 * Marca a Receita como REMOVIDA do pool por moderação (issue #18), via UPDATE direto das 3
 * colunas — testa os gates de pool isoladamente, sem passar pelos routes. Respeita o CHECK
 * recipe_moderation_consistency_chk: seta moderation_removed_at E moderated_by juntos. NÃO
 * toca `visibility` (remover-do-pool ≠ despublicar, AC3). `curatorId` deve ser id real.
 */
export async function seedRemovedFromPool(input: {
  recipeId: string
  curatorId: string
  reason?: string
}): Promise<void> {
  await getDb()
    .update(recipe)
    .set({
      moderationRemovedAt: new Date(),
      moderationReason: input.reason ?? 'removida em teste',
      moderatedBy: input.curatorId,
    })
    .where(eq(recipe.id, input.recipeId))
}

// ── Imagem da receita: entidade + ponteiro recipe.image_id (issues #130/#133) ────

/**
 * Insere uma `recipe_image` e aponta `recipe.image_id` para ela (espelha o setup inline de
 * `recipe-image-read.test.ts`). `blobUrl` NOT NULL (toda imagem tem blob). `moderated` opcional
 * semeia a imagem JÁ moderada (#133), respeitando o CHECK `recipe_image_moderation_consistency_chk`
 * (seta `moderated_at` E `moderated_by` juntos); `curatorId` deve ser id real de Usuário. Devolve o
 * id da imagem (útil p/ asserir o ref-count / o estado de moderação direto na tabela).
 */
export async function seedRecipeImage(input: {
  recipeId: string
  blobUrl?: string
  provenance?: ImageProvenance
  moderated?: { curatorId: string; reason?: string }
}): Promise<string> {
  // #222: a imagem PERTENCE à linhagem da Receita-alvo — lê a lineage_id e carimba (NOT NULL). Assim
  // a imagem semeada é membro REAL da galeria daquela Receita (seleção/galeria-delete a alcançam).
  const [r] = await getDb()
    .select({ lineageId: recipe.lineageId })
    .from(recipe)
    .where(eq(recipe.id, input.recipeId))
  const [img] = await getDb()
    .insert(recipeImage)
    .values({
      blobUrl: input.blobUrl ?? 'https://abc.public.blob.vercel-storage.com/recipes/x.webp',
      provenance: input.provenance ?? 'user_photo',
      lineageId: r.lineageId,
      ...(input.moderated
        ? {
            moderatedAt: new Date(),
            moderatedReason: input.moderated.reason ?? 'imagem moderada em teste',
            moderatedBy: input.moderated.curatorId,
          }
        : {}),
    })
    .returning({ id: recipeImage.id })
  await getDb().update(recipe).set({ imageId: img.id }).where(eq(recipe.id, input.recipeId))
  return img.id
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

// ── Matriz composta da Busca (issue #6, §4.1) ───────────────────────────────────

export type SearchMatrixIds = {
  A: string // catálogo private-default + owner NULL, pt-BR "Chili de carne" (pessoa)
  B: string // ai_chat public owned, pt-BR "Chili vegano" (pessoa)
  C: string // user_edited public owned, original en-US confiável + pt-BR auto-não-revisada
  C2: string // user_edited public owned, original pt-BR automatica_nao_revisada
  C3: string // user_edited public owned, original en-US não-revisado + pt-BR confiável
  D: string // ai_structured PRIVATE owned (barrada pelo gate)
  E: string // ai_chat playful (barrada pelo gate + exclusão explícita)
  F: string // catálogo "Biscoito de açúcar" (unaccent + stemming)
  F2: string // catálogo "Bolo de acucar" (título ARMAZENADO sem acento — sentido inverso do unaccent)
  G: string // catálogo "Bolo de cenoura" (controle: não casa "chili")
  ownerId: string // dono U das Receitas de Comunidade
  tituloCEnUS: string // titulo en-US original de C (asserção AC6 cross-locale)
}

/**
 * Semeia a matriz mínima da Busca (§4.1) que exercita TODOS os 6 ACs com uma busca
 * por "chili" (e variações de acento/plural). Reusa os átomos `seedRecipe`/
 * `seedTranslation`/`seedUser`. Devolve os ids semeados para os testes asserirem
 * pertencimento POR id (PKs não-determinísticos).
 *
 * Pontos sutis (C/C2/C3 dissecam `autoTranslationSignal` = base de `resolveName`,
 * NÃO o parêntese):
 *  - C  → base = original en-US confiável (pt-BR não-revisada NÃO anexada) ⇒ SEM sinal;
 *         a LINHA pt-BR casa o FTS (config portuguese) ⇒ cross-locale recall (AC6).
 *  - C2 → base = original pt-BR automatica_nao_revisada ⇒ COM sinal.
 *  - C3 → base = original en-US não-revisado + parêntese pt-BR confiável ⇒ COM sinal
 *         (o parêntese confiável NÃO limpa o sinal).
 *
 * Receitas de Comunidade visíveis têm dono ⇒ precisam `visibility='public'` para
 * passar o gate (owner NULL OR public). Catálogo usa owner NULL + visibility DEFAULT
 * de banco (private) — NÃO passar visibility='public': prova o gate owner-NULL (AC1).
 */
export async function seedSearchMatrix(): Promise<SearchMatrixIds> {
  const ownerId = await seedUser({ email: `busca-owner-${crypto.randomUUID()}@ex.com` })

  // A — catálogo: owner NULL + visibility DEFAULT (private). Visível via gate owner-NULL.
  const A = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({
    recipeId: A,
    locale: 'pt-BR',
    titulo: 'Chili de carne',
    descricao: 'Ensopado apimentado de carne moída e feijão.',
    provenance: 'escrita_por_pessoa',
  })

  // B — Comunidade pública (ai_chat), dono U.
  const B = await seedRecipe({
    origin: 'ai_chat',
    originalLocale: 'pt-BR',
    visibility: 'public',
    ownerId,
  })
  await seedTranslation({
    recipeId: B,
    locale: 'pt-BR',
    titulo: 'Chili vegano',
    descricao: 'Versão sem carne, com cogumelos.',
    provenance: 'escrita_por_pessoa',
  })

  // C — cross-locale SEM sinal: original en-US confiável + pt-BR auto-não-revisada,
  // ambas casam "chili". Base = original en-US confiável ⇒ sinal FALSE.
  const tituloCEnUS = 'Texas Chili'
  const C = await seedRecipe({
    origin: 'user_edited',
    originalLocale: 'en-US',
    visibility: 'public',
    ownerId,
  })
  await seedTranslation({
    recipeId: C,
    locale: 'en-US',
    titulo: tituloCEnUS,
    descricao: 'Slow-cooked beef chili.',
    provenance: 'escrita_por_pessoa',
  })
  await seedTranslation({
    recipeId: C,
    locale: 'pt-BR',
    titulo: 'Chili do Texas',
    descricao: 'Chili de carne cozido devagar.',
    provenance: 'automatica_nao_revisada',
  })

  // C2 — sinal POSITIVO (primeira classe): original pt-BR automatica_nao_revisada.
  // Base = próprio original pt-BR não-revisado (mesmo locale) ⇒ sinal TRUE.
  const C2 = await seedRecipe({
    origin: 'user_edited',
    originalLocale: 'pt-BR',
    visibility: 'public',
    ownerId,
  })
  await seedTranslation({
    recipeId: C2,
    locale: 'pt-BR',
    titulo: 'Chili secreto da vovó',
    descricao: 'Receita de chili não revisada.',
    provenance: 'automatica_nao_revisada',
  })

  // C3 — sinal POSITIVO COMPOSTO: original en-US não-revisado + tradução pt-BR
  // confiável (titulo diferente). Base = original en-US não-revisado ⇒ sinal TRUE
  // (o parêntese pt-BR confiável NÃO limpa o sinal).
  const C3 = await seedRecipe({
    origin: 'user_edited',
    originalLocale: 'en-US',
    visibility: 'public',
    ownerId,
  })
  await seedTranslation({
    recipeId: C3,
    locale: 'en-US',
    titulo: 'Smoky chili pot',
    descricao: 'Unreviewed original.',
    provenance: 'automatica_nao_revisada',
  })
  await seedTranslation({
    recipeId: C3,
    locale: 'pt-BR',
    titulo: 'Chili defumado na panela',
    descricao: 'Tradução pt-BR revisada e confiável.',
    provenance: 'automatica_revisada',
  })

  // D — Comunidade PRIVATE com dono ⇒ barrada pelo gate (casa "chili" mas não passa).
  const D = await seedRecipe({
    origin: 'ai_structured',
    originalLocale: 'pt-BR',
    visibility: 'private',
    ownerId,
  })
  await seedTranslation({
    recipeId: D,
    locale: 'pt-BR',
    titulo: 'Chili secreto',
    descricao: 'Privado, não deve aparecer.',
    provenance: 'escrita_por_pessoa',
  })

  // E — playful (private + dono) ⇒ barrada pelo gate E pela exclusão explícita.
  const E = await seedRecipe({
    origin: 'ai_chat',
    originalLocale: 'pt-BR',
    visibility: 'private',
    resultKind: 'playful',
    ownerId,
  })
  await seedTranslation({
    recipeId: E,
    locale: 'pt-BR',
    titulo: 'Chili impossível',
    descricao: 'Resultado lúdico, não deve aparecer.',
    provenance: 'escrita_por_pessoa',
  })

  // F — catálogo unaccent + stemming: "Biscoito de açúcar" + descrição com "açúcar".
  // owner NULL + visibility DEFAULT (private) ⇒ visível via gate owner-NULL.
  const F = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({
    recipeId: F,
    locale: 'pt-BR',
    titulo: 'Biscoito de açúcar',
    descricao: 'Biscoitos amanteigados cobertos de açúcar.',
    provenance: 'escrita_por_pessoa',
  })

  // F2 — catálogo unaccent SENTIDO INVERSO: título ARMAZENADO sem acento ("acucar").
  // Prova que uma query ACENTUADA ('açúcar') acha um valor armazenado SEM acento —
  // a direção que F (armazenado acentuado) sozinho não demonstra. owner NULL +
  // visibility DEFAULT (private) ⇒ visível via gate owner-NULL.
  const F2 = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({
    recipeId: F2,
    locale: 'pt-BR',
    titulo: 'Bolo de acucar',
    descricao: 'Bolo simples coberto de acucar.',
    provenance: 'escrita_por_pessoa',
  })

  // G — catálogo CONTROLE: "Bolo de cenoura" NÃO casa "chili".
  const G = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({
    recipeId: G,
    locale: 'pt-BR',
    titulo: 'Bolo de cenoura',
    descricao: 'Bolo fofinho de cenoura com cobertura de chocolate.',
    provenance: 'escrita_por_pessoa',
  })

  return { A, B, C, C2, C3, D, E, F, F2, G, ownerId, tituloCEnUS }
}

// ── Matriz composta da Busca por Ingrediente (issue #9, §4.1) ───────────────────

export type IngredientSearchMatrixIds = {
  R_cross: string // catálogo en-US: Item frango escrito em inglês; título sem token-ingrediente
  R_all: string // catálogo: frango + limao + alho (Itens canônicos)
  R_partial2: string // comunidade pública: frango + limao (SEM alho)
  R_raw: string // catálogo: só raw_text 'manjericão fresco' (ingredient_id NULL)
  R_qty: string // catálogo: Item frango com quantidade '2.500' + unidade kg, rawText NULL
  R_cebola: string // catálogo: Item cebolaRoxa (nome 'cebola-roxa' + alias hifenizado)
  R_cebolaDefeated: string // catálogo: Item cebolaRoxaDefeated (nome 'cebolaroxa', sem ponte)
  R_titleBoth: string // catálogo: UM Item frango; título casa o ?q= inteiro 'frango,limão'
  R_both: string // catálogo: Item frango (canônico) + rawText 'frango caipira' + Item alho
  R_titleOnly: string // catálogo: SEM Item alho; só título contém 'alho'
  R_titleIng: string // catálogo: Item alho E título contém 'alho'
  R_playful: string // comunidade playful: Item frango (barrada pelo gate)
  R_private: string // comunidade private owned: Item frango (barrada pelo gate)
  ownerId: string // dono U das Receitas de Comunidade
  // Ids canônicos (para variantes set-null / asserções diretas):
  frango: string
  limao: string
  alho: string
  cebolaRoxa: string
  cebolaRoxaDefeated: string
}

/**
 * Semeia a matriz mínima da Busca por INGREDIENTE (§4.1) que exercita os 5 ACs com um
 * conjunto de buscas. Montada a partir das fábricas atômicas (`seedRecipe`/
 * `seedTranslation`/`seedIngredient`/`seedIngredientTranslation`/`seedRecipeIngredient`/
 * `seedUser`). Devolve TODOS os ids para asserção por PERTENCIMENTO (PKs
 * não-determinísticos). `seedSearchMatrix` (#6) semeia ZERO ingredientes — esta é nova.
 *
 * INVARIANTE DE TÍTULO (load-bearing): os títulos NÃO contêm NENHUM token que stemize a
 * um nome de ingrediente semeado, para que o SINAL DE INGREDIENTE seja o que traz a
 * Receita (evita que o título resolva por acaso e mascare o eixo de ingrediente).
 * EXCEÇÕES INTENCIONAIS (únicas fixtures cujo título carrega termos da query, de
 * propósito): R_titleOnly / R_titleIng (sort-key primária) e R_titleBoth (all-vs-any).
 *
 * Gate: catálogo = owner NULL + visibility DEFAULT de banco (private) → visível via gate
 * owner-NULL; comunidade visível = dono + visibility='public'. R_playful/R_private são
 * controles de gate (NUNCA aparecem).
 *
 * Canônicos com translations/aliases ALL-LOCALE (a resolução varre TODOS os locales, sem
 * filtro por requestLocale — base do AC1 cross-locale):
 *  - frango  → pt-BR nome 'frango' alias ['galinha']; en-US nome 'chicken'.
 *  - limao   → pt-BR nome 'limão' alias ['lima']; en-US nome 'lime' alias ['lemon'].
 *  - alho    → pt-BR nome 'alho'; en-US nome 'garlic'.
 *  - cebolaRoxa (AC5 LOAD-BEARING) → pt-BR nome 'cebola-roxa' (forma hifenizada, NÃO
 *    'cebola roxa') alias ['cebola-roxa']; en-US nome 'red onion'. O ÚNICO token que
 *    dobra para a query 'cebola roxa' (com espaço) vive na forma hifenizada → a query só
 *    resolve este canônico VIA replace('-',' '). Se o fold hífen→espaço fosse removido,
 *    nenhum lado normalizar-igualaria 'cebola roxa' e o AC5 ficaria vermelho.
 *  - cebolaRoxaDefeated (AC5 isolamento) → pt-BR nome 'cebolaroxa' (sem hífen e sem
 *    espaço — nada dobra para 'cebola roxa'), SEM alias-ponte. Existe só para o AC5
 *    negativo: 'cebola roxa' NÃO o traz.
 */
export async function seedIngredientSearchMatrix(): Promise<IngredientSearchMatrixIds> {
  const ownerId = await seedUser({ email: `busca-ing-owner-${crypto.randomUUID()}@ex.com` })

  // ── Canônicos (ALL-LOCALE) ──────────────────────────────────────────────────
  const frango = await seedIngredient({ slug: `frango-${crypto.randomUUID()}` })
  await seedIngredientTranslation({
    ingredientId: frango,
    locale: 'pt-BR',
    nome: 'frango',
    aliases: ['galinha'],
  })
  await seedIngredientTranslation({ ingredientId: frango, locale: 'en-US', nome: 'chicken' })

  const limao = await seedIngredient({ slug: `limao-${crypto.randomUUID()}` })
  await seedIngredientTranslation({
    ingredientId: limao,
    locale: 'pt-BR',
    nome: 'limão',
    aliases: ['lima'],
  })
  await seedIngredientTranslation({
    ingredientId: limao,
    locale: 'en-US',
    nome: 'lime',
    aliases: ['lemon'],
  })

  const alho = await seedIngredient({ slug: `alho-${crypto.randomUUID()}` })
  await seedIngredientTranslation({ ingredientId: alho, locale: 'pt-BR', nome: 'alho' })
  await seedIngredientTranslation({ ingredientId: alho, locale: 'en-US', nome: 'garlic' })

  // cebolaRoxa — AC5 load-bearing: forma de superfície HIFENIZADA dos dois lados (nome E
  // alias). 'cebola roxa' (espaço) só resolve via replace('-',' ').
  const cebolaRoxa = await seedIngredient({ slug: `cebola-roxa-${crypto.randomUUID()}` })
  await seedIngredientTranslation({
    ingredientId: cebolaRoxa,
    locale: 'pt-BR',
    nome: 'cebola-roxa',
    aliases: ['cebola-roxa'],
  })
  await seedIngredientTranslation({ ingredientId: cebolaRoxa, locale: 'en-US', nome: 'red onion' })

  // cebolaRoxaDefeated — AC5 isolamento: 'cebolaroxa' (sem hífen/espaço), SEM ponte.
  const cebolaRoxaDefeated = await seedIngredient({ slug: `cebolaroxa-${crypto.randomUUID()}` })
  await seedIngredientTranslation({
    ingredientId: cebolaRoxaDefeated,
    locale: 'pt-BR',
    nome: 'cebolaroxa',
  })

  // ── Receitas ────────────────────────────────────────────────────────────────

  // R_cross — AC1 cross-locale. original en-US; Item ligado ao canônico frango mas
  // ESCRITO EM INGLÊS no raw_text ('chicken thighs'); título en-US SEM token que stemize
  // a um nome de ingrediente semeado (nem 'chicken'/'frango'). owner NULL + visibility
  // DEFAULT (private) → visível via gate owner-NULL.
  const R_cross = await seedRecipe({ origin: 'catalog', originalLocale: 'en-US', ownerId: null })
  await seedTranslation({
    recipeId: R_cross,
    locale: 'en-US',
    titulo: 'Grilled thighs over coals',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeIngredient({ recipeId: R_cross, ingredientId: frango, ordem: 0, rawText: 'chicken thighs' })

  // R_all — AC2: três Itens canônicos (frango, limao, alho), todos rawText=NULL.
  const R_all = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({
    recipeId: R_all,
    locale: 'pt-BR',
    titulo: 'Marmita completa do dia',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeIngredient({ recipeId: R_all, ingredientId: frango, ordem: 0 })
  await seedRecipeIngredient({ recipeId: R_all, ingredientId: limao, ordem: 1 })
  await seedRecipeIngredient({ recipeId: R_all, ingredientId: alho, ordem: 2 })

  // R_partial2 — AC2: frango + limao (SEM alho). Comunidade pública (ai_chat), dono U.
  const R_partial2 = await seedRecipe({
    origin: 'ai_chat',
    originalLocale: 'pt-BR',
    visibility: 'public',
    ownerId,
  })
  await seedTranslation({
    recipeId: R_partial2,
    locale: 'pt-BR',
    titulo: 'Prato rápido da semana',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeIngredient({ recipeId: R_partial2, ingredientId: frango, ordem: 0 })
  await seedRecipeIngredient({ recipeId: R_partial2, ingredientId: limao, ordem: 1 })

  // R_raw — AC3 degradação: UM Item SÓ raw_text 'manjericão fresco', ingredient_id=NULL.
  // Sem canônico → só acha por FTS sobre raw_text.
  const R_raw = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({
    recipeId: R_raw,
    locale: 'pt-BR',
    titulo: 'Molho verde da casa',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeIngredient({
    recipeId: R_raw,
    ingredientId: null,
    ordem: 0,
    rawText: 'manjericão fresco',
  })

  // R_qty — AC4: Item frango com quantidade '2.500' + unidade kg e rawText=NULL. O
  // rawText DEVE ser NULL (NÃO improvisar '2.5 kg de frango' — isso rotearia 2.5/kg pela
  // CTE de degradação raw_text, sempre-ligada, quebrando a negação do AC4).
  const R_qty = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({
    recipeId: R_qty,
    locale: 'pt-BR',
    titulo: 'Assado de domingo',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeIngredient({
    recipeId: R_qty,
    ingredientId: frango,
    ordem: 0,
    quantidade: '2.500',
    unidade: 'kg',
  })

  // R_cebola — AC5: UM Item cebolaRoxa, rawText=NULL; título sem token 'cebola' nu.
  // rawText NULL (senão a degradação sempre-ligada poderia trazê-la via 'cebola' no
  // raw_text, mascarando o negativo do AC5).
  const R_cebola = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({
    recipeId: R_cebola,
    locale: 'pt-BR',
    titulo: 'Salada da horta crocante',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeIngredient({ recipeId: R_cebola, ingredientId: cebolaRoxa, ordem: 0 })

  // R_cebolaDefeated — AC5 isolamento: UM Item cebolaRoxaDefeated, rawText=NULL; título
  // sem 'cebola' nu. 'cebola roxa' NÃO o traz (o fold só salva quem tem hífen/espaço).
  const R_cebolaDefeated = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    ownerId: null,
  })
  await seedTranslation({
    recipeId: R_cebolaDefeated,
    locale: 'pt-BR',
    titulo: 'Conserva agridoce do pote',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeIngredient({ recipeId: R_cebolaDefeated, ingredientId: cebolaRoxaDefeated, ordem: 0 })

  // R_titleBoth — EXTRA all-vs-any. EXCEÇÃO à invariante de título: título
  // 'Frango com limão na brasa' FTS-casa o ?q= INTEIRO 'frango,limão' (vírgula→AND, então
  // o título PRECISA conter AMBOS). Exatamente UM Item ligado ao canônico frango; SEM Item
  // limao, SEM 'limão' no raw_text → overlap=1, N=2. Em 'all' EXCLUI (título não supre o
  // termo faltante); em 'any' INCLUI.
  const R_titleBoth = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({
    recipeId: R_titleBoth,
    locale: 'pt-BR',
    titulo: 'Frango com limão na brasa',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeIngredient({ recipeId: R_titleBoth, ingredientId: frango, ordem: 0 })

  // R_both — EXTRA dedup canônico↔raw_text. DOIS Itens: um ligado ao canônico frango E com
  // rawText='frango caipira' (frango satisfeito por AMBOS os sinais), e outro ligado a
  // alho. Título sem 'frango'/'alho' nu. Para 'frango,alho' em 'all': frango conta UMA vez
  // (UNION + COUNT DISTINCT) → overlap=2=N → INCLUI.
  const R_both = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({
    recipeId: R_both,
    locale: 'pt-BR',
    titulo: 'Panela caipira da roça',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeIngredient({
    recipeId: R_both,
    ingredientId: frango,
    ordem: 0,
    rawText: 'frango caipira',
  })
  await seedRecipeIngredient({ recipeId: R_both, ingredientId: alho, ordem: 1 })

  // R_titleOnly — EXTRA sort-key primária. EXCEÇÃO à invariante: título contém 'alho' mas
  // NENHUM Item alho → (overlap=0 + title=1)=1. Mesma seção (catálogo/owner-NULL) que
  // R_titleIng.
  const R_titleOnly = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({
    recipeId: R_titleOnly,
    locale: 'pt-BR',
    titulo: 'Pão de alho na chapa',
    provenance: 'escrita_por_pessoa',
  })

  // R_titleIng — EXTRA sort-key primária. EXCEÇÃO à invariante: título contém 'alho' E há
  // UM Item alho → (overlap=1 + title=1)=2 → outranks R_titleOnly mesmo com ts_rank menor.
  const R_titleIng = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({
    recipeId: R_titleIng,
    locale: 'pt-BR',
    titulo: 'Frango ao alho e óleo',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeIngredient({ recipeId: R_titleIng, ingredientId: alho, ordem: 0 })

  // R_playful — controle de gate: playful (private + dono) ⇒ NUNCA aparece.
  const R_playful = await seedRecipe({
    origin: 'ai_chat',
    originalLocale: 'pt-BR',
    visibility: 'private',
    resultKind: 'playful',
    ownerId,
  })
  await seedTranslation({
    recipeId: R_playful,
    locale: 'pt-BR',
    titulo: 'Experimento lúdico da cozinha',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeIngredient({ recipeId: R_playful, ingredientId: frango, ordem: 0 })

  // R_private — controle de gate: private COM dono ⇒ NUNCA aparece.
  const R_private = await seedRecipe({
    origin: 'ai_structured',
    originalLocale: 'pt-BR',
    visibility: 'private',
    ownerId,
  })
  await seedTranslation({
    recipeId: R_private,
    locale: 'pt-BR',
    titulo: 'Receita guardada do caderno',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeIngredient({ recipeId: R_private, ingredientId: frango, ordem: 0 })

  return {
    R_cross,
    R_all,
    R_partial2,
    R_raw,
    R_qty,
    R_cebola,
    R_cebolaDefeated,
    R_titleBoth,
    R_both,
    R_titleOnly,
    R_titleIng,
    R_playful,
    R_private,
    ownerId,
    frango,
    limao,
    alho,
    cebolaRoxa,
    cebolaRoxaDefeated,
  }
}

// ── Matriz composta das Facetas + Perfil culinário (issue #10, §3.1) ─────────────

/**
 * Cria/RESOLVE a Tag por nome NORMALIZADO (lower+trim — `tag.nome` é único) e a liga à
 * Receita. Idempotente quanto à Tag: várias Receitas podem compartilhar o MESMO nome (ex.
 * 'Leve' em F_jpDoce/F_thLeve/F_playful) sem violar `tag_nome_uq`. Devolve o tag id.
 */
export async function seedRecipeTag(recipeId: string, nome: string): Promise<string> {
  const normalized = nome.toLowerCase().trim()
  const existing = await getDb()
    .select({ id: tag.id })
    .from(tag)
    .where(eq(tag.nome, normalized))
    .limit(1)
  const tagId = existing[0]?.id ?? (await seedTag(nome))
  await linkRecipeTag(recipeId, tagId)
  return tagId
}

export type FacetMatrixIds = {
  F_jpDoce: string // catalog japonesa/sobremesa, dific 2, tag 'Leve', "Curry doce..."
  F_jpPrato: string // catalog japonesa/prato, [vegano], dific 4, "Curry de legumes..."
  F_brDoce: string // catalog brasileira/sobremesa, [sem_gluten,sem_lactose], "Curry doce baiano..."
  F_itPrato: string // ai_chat public italiana/prato, [vegetariano], "Curry italiano..."
  F_thLeve: string // catalog tailandesa/prato, tags Leve+Saudável+baixa-caloria, "Curry de coco..."
  F_xxSaud: string // catalog francesa/prato, tag 'Saudável' (sem 'leve'), "Ratatouille..."
  F_nullNums: string // catalog indiana/prato, [vegano,sem_gluten], dific NULL, porcoes NULL
  F_multiR: string // catalog mexicana/prato, [vegano,sem_gluten], "Tacos de jaca"
  F_oneR: string // catalog mexicana/prato, [vegano], "Tacos de cogumelo"
  F_tagDefeated: string // catalog portuguesa/prato, tag 'saudavelx' (sem-ponte)
  F_decoy: string // catalog francesa/prato, dific 5, título "Prato asiático leve da casa"
  F_playful: string // ai_chat playful (private,owned) japonesa/sobremesa, tag 'Leve'
  F_priv: string // ai_structured private (owned) japonesa/sobremesa, tag 'Leve'
  ownerId: string // dono U das Receitas de Comunidade/private
}

/**
 * Semeia a matriz das FACETAS (#10) — cada Receita pensada para travar um AC e seus
 * controles negativos NÃO-vacuamente-verdes. Reusa as fábricas atômicas; devolve os ids
 * para asserção por PERTENCIMENTO (PKs não-determinísticos).
 *
 * Pontos LOAD-BEARING (ver plano §3.1):
 *  - 'curry' fixado no TÍTULO dos alvos do AC1 (F_jpDoce/F_jpPrato/F_itPrato/F_brDoce/
 *    F_thLeve) ⇒ a positiva `search('curry',{cozinha:japonesa})` não é vácua.
 *  - Os alvos da LENTE (AC3, F_thLeve/F_jpDoce) têm título SEM "asiático"/"leve" ⇒ o
 *    recall vem da faceta resolvida, não do FTS. F_decoy tem "asiático leve" no título mas
 *    cozinha NÃO-asiática + dific 5 ⇒ NÃO aparece em `search('asiático e leve')`.
 *  - Tags em SURFACE FORM não-folded ('Leve'/'Saudável' acentuada/'baixa-caloria'
 *    hifenada): seedTag só faz lower+trim ⇒ armazena 'saudável'/'baixa-caloria' ⇒ o fold
 *    SQL `lower(immutable_unaccent(replace(...)))` é load-bearing. F_tagDefeated tem
 *    'saudavelx' (sem-ponte) ⇒ `?tag=saudavel` NÃO o traz (igualdade normalizada exata).
 *  - F_playful/F_priv casam cozinha=japonesa mas NUNCA aparecem (gate AND-combinado no
 *    ramo faceta-only). F_nullNums tem dific/porcoes NULL (cai fora de qualquer faixa).
 *
 * Gate: catálogo = owner NULL + visibility DEFAULT (private) ⇒ visível via gate owner-NULL;
 * comunidade visível = dono + visibility='public'.
 */
export async function seedFacetMatrix(): Promise<FacetMatrixIds> {
  const ownerId = await seedUser({ email: `facetas-owner-${crypto.randomUUID()}@ex.com` })

  // F_jpDoce — AC1 alvo japonês+curry; AC3 alvo (tag 'Leve' p/ a lente). Catálogo.
  const F_jpDoce = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    ownerId: null,
    cozinha: 'japonesa',
    categoria: 'sobremesa',
    restricoes: [],
    dificuldade: 2,
    porcoes: 4,
  })
  await seedTranslation({
    recipeId: F_jpDoce,
    locale: 'pt-BR',
    titulo: 'Curry doce de feijão azuki',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeTag(F_jpDoce, 'Leve')

  // F_jpPrato — AC1 estreita por categoria/restrição. Catálogo.
  const F_jpPrato = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    ownerId: null,
    cozinha: 'japonesa',
    categoria: 'prato_principal',
    restricoes: ['vegano'],
    dificuldade: 4,
    porcoes: 2,
  })
  await seedTranslation({
    recipeId: F_jpPrato,
    locale: 'pt-BR',
    titulo: 'Curry de legumes no missô',
    provenance: 'escrita_por_pessoa',
  })

  // F_brDoce — controle: casa 'curry' mas NÃO é cozinha asiática. Catálogo.
  const F_brDoce = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    ownerId: null,
    cozinha: 'brasileira',
    categoria: 'sobremesa',
    restricoes: ['sem_gluten', 'sem_lactose'],
    dificuldade: 1,
    porcoes: 8,
  })
  await seedTranslation({
    recipeId: F_brDoce,
    locale: 'pt-BR',
    titulo: 'Curry doce baiano de coco',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeTag(F_brDoce, 'classico')

  // F_itPrato — comunidade visível (ai_chat public, dono); controle de cozinha (casa 'curry').
  const F_itPrato = await seedRecipe({
    origin: 'ai_chat',
    originalLocale: 'pt-BR',
    visibility: 'public',
    ownerId,
    cozinha: 'italiana',
    categoria: 'prato_principal',
    restricoes: ['vegetariano'],
    dificuldade: 3,
    porcoes: 6,
  })
  await seedTranslation({
    recipeId: F_itPrato,
    locale: 'pt-BR',
    titulo: 'Curry italiano de grão-de-bico',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeTag(F_itPrato, 'rapido')

  // F_thLeve — AC3 alvo "asiático e leve" via lente (tag 'Leve' p/ a lente casar);
  // 'Saudável'/'baixa-caloria' p/ o fold de acento/hífen. Catálogo. Título SEM
  // "asiático"/"leve" (recall via faceta resolvida, não FTS).
  const F_thLeve = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    ownerId: null,
    cozinha: 'tailandesa',
    categoria: 'prato_principal',
    restricoes: [],
    dificuldade: 1,
    porcoes: 2,
  })
  await seedTranslation({
    recipeId: F_thLeve,
    locale: 'pt-BR',
    titulo: 'Curry de coco da casa',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeTag(F_thLeve, 'Leve')
  await seedRecipeTag(F_thLeve, 'Saudável')
  await seedRecipeTag(F_thLeve, 'baixa-caloria')

  // F_xxSaud — AC2 OR de tag: SÓ 'Saudável' (sem 'leve'). Catálogo.
  const F_xxSaud = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    ownerId: null,
    cozinha: 'francesa',
    categoria: 'prato_principal',
    restricoes: [],
    dificuldade: 2,
    porcoes: 4,
  })
  await seedTranslation({
    recipeId: F_xxSaud,
    locale: 'pt-BR',
    titulo: 'Ratatouille de forno',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeTag(F_xxSaud, 'Saudável')

  // F_nullNums — TRAVA NULL handling (dific/porcoes NULL ⇒ cai fora de qualquer faixa).
  const F_nullNums = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    ownerId: null,
    cozinha: 'indiana',
    categoria: 'prato_principal',
    restricoes: ['vegano', 'sem_gluten'],
    dificuldade: null,
    porcoes: null,
  })
  await seedTranslation({
    recipeId: F_nullNums,
    locale: 'pt-BR',
    titulo: 'Dal de lentilha',
    provenance: 'escrita_por_pessoa',
  })

  // F_multiR — AC2 restrição AND-contém-todas (vegano E sem_gluten). Catálogo.
  const F_multiR = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    ownerId: null,
    cozinha: 'mexicana',
    categoria: 'prato_principal',
    restricoes: ['vegano', 'sem_gluten'],
    dificuldade: 2,
    porcoes: 4,
  })
  await seedTranslation({
    recipeId: F_multiR,
    locale: 'pt-BR',
    titulo: 'Tacos de jaca',
    provenance: 'escrita_por_pessoa',
  })

  // F_oneR — AC2 controle: vegano só, NÃO sem_gluten (prova @> contém-todas vs && overlap).
  const F_oneR = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    ownerId: null,
    cozinha: 'mexicana',
    categoria: 'prato_principal',
    restricoes: ['vegano'],
    dificuldade: 2,
    porcoes: 4,
  })
  await seedTranslation({
    recipeId: F_oneR,
    locale: 'pt-BR',
    titulo: 'Tacos de cogumelo',
    provenance: 'escrita_por_pessoa',
  })

  // F_tagDefeated — AC2 controle de isolamento de fold (espelha cebolaRoxaDefeated):
  // surface 'saudavelx' (já sem acento, NÃO é 'saudavel', sem ponte) ⇒ NÃO casa ?tag=saudavel.
  const F_tagDefeated = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    ownerId: null,
    cozinha: 'portuguesa',
    categoria: 'prato_principal',
    restricoes: [],
    dificuldade: 3,
    porcoes: 4,
  })
  await seedTranslation({
    recipeId: F_tagDefeated,
    locale: 'pt-BR',
    titulo: 'Bacalhau à brás',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeTag(F_tagDefeated, 'saudavelx')

  // F_decoy — AC3 controle: título contém "asiático leve" mas cozinha não-asiática,
  // dific 5 (fora do max:2 da lente), tags sem 'leve'/'saudavel'. NÃO aparece em
  // `search('asiático e leve')` (faceta-only; nenhum FTS roda — a lente consumiu os tokens).
  const F_decoy = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    ownerId: null,
    cozinha: 'francesa',
    categoria: 'prato_principal',
    restricoes: [],
    dificuldade: 5,
    porcoes: 4,
  })
  await seedTranslation({
    recipeId: F_decoy,
    locale: 'pt-BR',
    titulo: 'Prato asiático leve da casa',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeTag(F_decoy, 'gourmet')

  // F_playful — gate-control: casa cozinha=japonesa/tag 'Leve' mas NUNCA aparece (playful).
  const F_playful = await seedRecipe({
    origin: 'ai_chat',
    originalLocale: 'pt-BR',
    visibility: 'private',
    resultKind: 'playful',
    ownerId,
    cozinha: 'japonesa',
    categoria: 'sobremesa',
    restricoes: [],
    dificuldade: 1,
    porcoes: 2,
  })
  await seedTranslation({
    recipeId: F_playful,
    locale: 'pt-BR',
    titulo: 'Curry de unicórnio',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeTag(F_playful, 'Leve')

  // F_priv — gate-control: private COM dono; casa cozinha=japonesa/tag 'Leve' mas NUNCA aparece.
  const F_priv = await seedRecipe({
    origin: 'ai_structured',
    originalLocale: 'pt-BR',
    visibility: 'private',
    ownerId,
    cozinha: 'japonesa',
    categoria: 'sobremesa',
    restricoes: [],
    dificuldade: 1,
    porcoes: 2,
  })
  await seedTranslation({
    recipeId: F_priv,
    locale: 'pt-BR',
    titulo: 'Curry secreto',
    provenance: 'escrita_por_pessoa',
  })
  await seedRecipeTag(F_priv, 'Leve')

  return {
    F_jpDoce,
    F_jpPrato,
    F_brDoce,
    F_itPrato,
    F_thLeve,
    F_xxSaud,
    F_nullNums,
    F_multiR,
    F_oneR,
    F_tagDefeated,
    F_decoy,
    F_playful,
    F_priv,
    ownerId,
  }
}
