import { asc, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import {
  briefing,
  briefingItem,
  collection,
  collectionItem,
  creationSession,
  generation,
  imageGeneration,
  notification,
  recipe,
  recipeIngredient,
  recipeReview,
  recipeSave,
  recipeTranslation,
  transcriptMessage,
  userFollow,
  users,
} from '@/db/schema'

/**
 * Montagem do EXPORT self-service dos dados da conta (issue #401, GAP-6; LGPD Art. 18 II/V — acesso +
 * portabilidade; `docs/legal/takedown-e-remocao-titular.md` §8). PURO de efeitos exceto LEITURA — só
 * consulta, nunca escreve.
 *
 * SÓ o próprio titular: o route passa o `session.user.id` (nunca um id do cliente ⇒ sem IDOR). Todas
 * as consultas são ESCOPADAS por esse id (owner_id / user_id / recipient_id / follower_id).
 *
 * NUNCA vaza PII de TERCEIROS (inegociável): o social só carrega HANDLES PÚBLICOS de quem o titular
 * SEGUE (mais contagens) — jamais e-mail/nome de terceiros; a lista de SEGUIDORES é só CONTAGEM (a
 * escolha de quem segue quem é de terceiros). As notificações trazem tipo/timestamps/refs, SEM a
 * identidade do ator (terceiro). Tudo o mais é conteúdo do próprio titular (receitas que ele criou,
 * suas avaliações, saves, coleções, histórico de geração/conversa — seus prompts em texto livre).
 *
 * Portável/legível: JSON plano e versionado (`format`), pronto para o titular ler ou reimportar.
 */

const EXPORT_FORMAT = 'refogando-account-export/v1'

/** Agrupa linhas-filhas por uma chave estrangeira, preservando a ordem de chegada. */
function groupBy<T, K extends string>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const row of rows) {
    const k = key(row)
    const bucket = map.get(k)
    if (bucket) bucket.push(row)
    else map.set(k, [row])
  }
  return map
}

export async function buildAccountExport(db: Database, userId: string): Promise<Record<string, unknown>> {
  // ── Perfil (dados de conta do próprio titular) ────────────────────────────────
  const [profile] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      handle: users.handle,
      bio: users.bio,
      links: users.links,
      locale: users.locale,
      image: users.image,
      role: users.role,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, userId))

  // ── Receitas que o titular criou/possui (owner_id = titular) ──────────────────
  const recipeRows = await db
    .select({
      id: recipe.id,
      origin: recipe.origin,
      visibility: recipe.visibility,
      resultKind: recipe.resultKind,
      cozinha: recipe.cozinha,
      categoria: recipe.categoria,
      restricoes: recipe.restricoes,
      porcoes: recipe.porcoes,
      dificuldade: recipe.dificuldade,
      tempoAtivoMin: recipe.tempoAtivoMin,
      tempoTotalMin: recipe.tempoTotalMin,
      sourceUrl: recipe.sourceUrl,
      sourceName: recipe.sourceName,
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt,
    })
    .from(recipe)
    .where(eq(recipe.ownerId, userId))
    .orderBy(asc(recipe.createdAt))
  const recipeIds = recipeRows.map((r) => r.id)

  const [translationRows, ingredientRows] = await Promise.all([
    recipeIds.length > 0
      ? db
          .select({
            recipeId: recipeTranslation.recipeId,
            locale: recipeTranslation.locale,
            titulo: recipeTranslation.titulo,
            descricao: recipeTranslation.descricao,
            passos: recipeTranslation.passos,
            notas: recipeTranslation.notas,
            slug: recipeTranslation.slug,
          })
          .from(recipeTranslation)
          .where(inArray(recipeTranslation.recipeId, recipeIds))
      : Promise.resolve([]),
    recipeIds.length > 0
      ? db
          .select({
            recipeId: recipeIngredient.recipeId,
            ordem: recipeIngredient.ordem,
            quantidade: recipeIngredient.quantidade,
            unidade: recipeIngredient.unidade,
            rawText: recipeIngredient.rawText,
            nota: recipeIngredient.nota,
          })
          .from(recipeIngredient)
          .where(inArray(recipeIngredient.recipeId, recipeIds))
          .orderBy(asc(recipeIngredient.ordem))
      : Promise.resolve([]),
  ])
  const translationsByRecipe = groupBy(translationRows, (r) => r.recipeId)
  const ingredientsByRecipe = groupBy(ingredientRows, (r) => r.recipeId)
  const recipes = recipeRows.map(({ id, ...rest }) => ({
    id,
    ...rest,
    translations: (translationsByRecipe.get(id) ?? []).map((t) => ({
      locale: t.locale,
      titulo: t.titulo,
      descricao: t.descricao,
      passos: t.passos,
      notas: t.notas,
      slug: t.slug,
    })),
    ingredients: (ingredientsByRecipe.get(id) ?? []).map((i) => ({
      ordem: i.ordem,
      quantidade: i.quantidade,
      unidade: i.unidade,
      rawText: i.rawText,
      nota: i.nota,
    })),
  }))

  // ── Avaliações escritas pelo titular ─────────────────────────────────────────
  const reviews = await db
    .select({
      recipeId: recipeReview.recipeId,
      rating: recipeReview.rating,
      comment: recipeReview.comment,
      photoUrl: recipeReview.photoUrl,
      createdAt: recipeReview.createdAt,
      updatedAt: recipeReview.updatedAt,
    })
    .from(recipeReview)
    .where(eq(recipeReview.userId, userId))
    .orderBy(asc(recipeReview.createdAt))

  // ── Receitas salvas ──────────────────────────────────────────────────────────
  const savedRecipes = await db
    .select({ recipeId: recipeSave.recipeId, savedAt: recipeSave.createdAt })
    .from(recipeSave)
    .where(eq(recipeSave.userId, userId))
    .orderBy(asc(recipeSave.createdAt))

  // ── Coleções (pastas privadas) + seus itens ──────────────────────────────────
  const collectionRows = await db
    .select({ id: collection.id, name: collection.name, createdAt: collection.createdAt })
    .from(collection)
    .where(eq(collection.userId, userId))
    .orderBy(asc(collection.createdAt))
  const collectionIds = collectionRows.map((c) => c.id)
  const collectionItemRows =
    collectionIds.length > 0
      ? await db
          .select({ collectionId: collectionItem.collectionId, recipeId: collectionItem.recipeId })
          .from(collectionItem)
          .where(inArray(collectionItem.collectionId, collectionIds))
      : []
  const itemsByCollection = groupBy(collectionItemRows, (r) => r.collectionId)
  const collections = collectionRows.map((c) => ({
    id: c.id,
    name: c.name,
    createdAt: c.createdAt,
    recipeIds: (itemsByCollection.get(c.id) ?? []).map((i) => i.recipeId),
  }))

  // ── Social: SÓ handles públicos de quem o titular segue + contagens. NUNCA PII de terceiros
  //    (sem e-mail/nome de terceiros); a lista de SEGUIDORES é só CONTAGEM (escolha de terceiros).
  const followingRows = await db
    .select({ handle: users.handle, since: userFollow.createdAt })
    .from(userFollow)
    .innerJoin(users, eq(users.id, userFollow.followeeId))
    .where(eq(userFollow.followerId, userId))
    .orderBy(asc(userFollow.createdAt))
  const [{ n: followersCount } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(userFollow)
    .where(eq(userFollow.followeeId, userId))

  // ── Notificações (a caixa do titular): tipo + timestamps + refs. SEM identidade do ator. ─────
  const notifications = await db
    .select({
      type: notification.type,
      recipeId: notification.recipeId,
      reviewId: notification.reviewId,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
    })
    .from(notification)
    .where(eq(notification.recipientId, userId))
    .orderBy(asc(notification.createdAt))

  // ── Ledger de geração de imagem por IA (custo/tokens do próprio titular) ──────
  const imageGenerations = await db
    .select({
      model: imageGeneration.model,
      promptTokens: imageGeneration.promptTokens,
      outputTokens: imageGeneration.outputTokens,
      thinkingTokens: imageGeneration.thinkingTokens,
      totalTokens: imageGeneration.totalTokens,
      costUsd: imageGeneration.costUsd,
      createdAt: imageGeneration.createdAt,
    })
    .from(imageGeneration)
    .where(eq(imageGeneration.userId, userId))
    .orderBy(asc(imageGeneration.createdAt))

  // ── Histórico de criação: sessões + briefing + gerações + transcrição (dados do próprio
  //    titular — inclusive prompts em texto livre e o diálogo). ──────────────────
  const sessionRows = await db
    .select({
      id: creationSession.id,
      mode: creationSession.mode,
      recipeId: creationSession.recipeId,
      briefingId: creationSession.briefingId,
      freeText: creationSession.freeText,
      createdAt: creationSession.createdAt,
    })
    .from(creationSession)
    .where(eq(creationSession.userId, userId))
    .orderBy(asc(creationSession.createdAt))
  const sessionIds = sessionRows.map((s) => s.id)
  const briefingIds = sessionRows.map((s) => s.briefingId).filter((id): id is string => id != null)

  const [generationRows, transcriptRows, briefingRows] = await Promise.all([
    sessionIds.length > 0
      ? db
          .select({
            creationSessionId: generation.creationSessionId,
            recipeId: generation.recipeId,
            outcome: generation.outcome,
            advisoryComment: generation.advisoryComment,
            model: generation.model,
            createdAt: generation.createdAt,
          })
          .from(generation)
          .where(inArray(generation.creationSessionId, sessionIds))
          .orderBy(asc(generation.createdAt))
      : Promise.resolve([]),
    sessionIds.length > 0
      ? db
          .select({
            creationSessionId: transcriptMessage.creationSessionId,
            role: transcriptMessage.role,
            content: transcriptMessage.content,
            seq: transcriptMessage.seq,
            createdAt: transcriptMessage.createdAt,
          })
          .from(transcriptMessage)
          .where(inArray(transcriptMessage.creationSessionId, sessionIds))
          .orderBy(asc(transcriptMessage.seq))
      : Promise.resolve([]),
    briefingIds.length > 0
      ? db
          .select({
            id: briefing.id,
            cozinha: briefing.cozinha,
            restricoes: briefing.restricoes,
            porcoes: briefing.porcoes,
            dificuldade: briefing.dificuldade,
            observacoes: briefing.observacoes,
          })
          .from(briefing)
          .where(inArray(briefing.id, briefingIds))
      : Promise.resolve([]),
  ])
  const briefingItemRows =
    briefingIds.length > 0
      ? await db
          .select({
            briefingId: briefingItem.briefingId,
            strength: briefingItem.strength,
            rawText: briefingItem.rawText,
            quantidade: briefingItem.quantidade,
            unidade: briefingItem.unidade,
            ordem: briefingItem.ordem,
          })
          .from(briefingItem)
          .where(inArray(briefingItem.briefingId, briefingIds))
          .orderBy(asc(briefingItem.ordem))
      : []

  const generationsBySession = groupBy(generationRows, (r) => r.creationSessionId)
  const transcriptBySession = groupBy(transcriptRows, (r) => r.creationSessionId)
  const itemsByBriefing = groupBy(briefingItemRows, (r) => r.briefingId)
  const briefingById = new Map(briefingRows.map((b) => [b.id, b]))

  const creationSessions = sessionRows.map((s) => {
    const b = s.briefingId != null ? briefingById.get(s.briefingId) : undefined
    return {
      id: s.id,
      mode: s.mode,
      recipeId: s.recipeId,
      freeText: s.freeText,
      createdAt: s.createdAt,
      briefing: b
        ? {
            cozinha: b.cozinha,
            restricoes: b.restricoes,
            porcoes: b.porcoes,
            dificuldade: b.dificuldade,
            observacoes: b.observacoes,
            items: (itemsByBriefing.get(b.id) ?? []).map((i) => ({
              strength: i.strength,
              rawText: i.rawText,
              quantidade: i.quantidade,
              unidade: i.unidade,
              ordem: i.ordem,
            })),
          }
        : null,
      generations: (generationsBySession.get(s.id) ?? []).map((gn) => ({
        recipeId: gn.recipeId,
        outcome: gn.outcome,
        advisoryComment: gn.advisoryComment,
        model: gn.model,
        createdAt: gn.createdAt,
      })),
      transcript: (transcriptBySession.get(s.id) ?? []).map((m) => ({
        role: m.role,
        content: m.content,
        seq: m.seq,
        createdAt: m.createdAt,
      })),
    }
  })

  return {
    format: EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    account: profile ?? null,
    recipes,
    reviews,
    savedRecipes,
    collections,
    social: {
      followingCount: followingRows.length,
      followersCount,
      following: followingRows,
    },
    notifications,
    imageGenerations,
    creationSessions,
  }
}
