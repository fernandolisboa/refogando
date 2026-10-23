import { asc, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import {
  // Alias: `account` abaixo é a seção do perfil; esta é a tabela de logins do Better Auth (senha e Google).
  account as authAccount,
  briefing,
  briefingItem,
  collection,
  collectionItem,
  creationSession,
  extractionEvent,
  generation,
  imageGeneration,
  mealPlanEntry,
  mealPlanSuggestionEvent,
  pantryItem,
  notification,
  recipe,
  recipeImage,
  recipeIngredient,
  recipeReview,
  recipeSave,
  recipeTranslation,
  report,
  // Alias: `sessionRows`/`creationSession` abaixo são as sessões de CRIAÇÃO; esta é a de login.
  session as loginSession,
  shoppingList,
  shoppingListItem,
  transcriptMessage,
  userFollow,
  users,
} from '@/db/schema'
import { exportablePromptStamp, type JsonObjectSection } from '@/domain/account-export'

/**
 * Montagem do EXPORT self-service dos dados da conta (issue #401, GAP-6; LGPD Art. 18, II e V — acesso +
 * portabilidade; `docs/legal/takedown-e-remocao-titular.md` §6). PURO de efeitos exceto LEITURA — só
 * consulta, nunca escreve.
 *
 * SÓ o próprio titular: o route passa o `session.user.id` (nunca um id do cliente ⇒ sem IDOR). Todas
 * as consultas são ESCOPADAS por esse id (owner_id / user_id / recipient_id / follower_id).
 *
 * NUNCA vaza PII de TERCEIROS (inegociável): o social só carrega HANDLES PÚBLICOS de quem o titular
 * SEGUE (mais contagens) — jamais e-mail/nome de terceiros; a lista de SEGUIDORES é só CONTAGEM (a
 * escolha de quem segue quem é de terceiros). As notificações trazem tipo/timestamps/refs, SEM a
 * identidade do ator (terceiro). Tudo o mais é conteúdo do próprio titular (receitas que ele criou,
 * suas avaliações, saves, coleções, listas de compras, plano de refeições, histórico de geração/conversa — seus prompts em texto livre).
 *
 * #595 completou o export com o que ainda ficava de fora:
 *  - `account`: também o plano e as sanções sobre a conta (`banned`, `banReason`, `banExpires`, e o bloqueio
 *    de gerar imagem com data e motivo).
 *  - `recipeImages`: as imagens que o titular enviou ou gerou (`recipe_image.created_by`), com as URLs.
 *    `recipes[].imageId` é a capa de cada receita; pode apontar para uma imagem fora desta lista (gerada
 *    pelo Curador, ou da galeria da linhagem com outro `created_by`), então não é chave garantida para
 *    `recipeImages[]`.
 *  - A moderação do conteúdo do titular: quando e por quê uma receita saiu do pool
 *    (`recipes[].moderationRemovedAt`/`moderationReason`) e uma avaliação ou imagem foi moderada
 *    (`moderatedAt`/`moderatedReason`).
 *  - `loginSessions`: os acessos (criação, última atividade, validade, IP e navegador).
 *  - `logins`: os jeitos de entrar (`provider` = `credential` para e-mail e senha, `google`), com o id da
 *    conta no provedor, o escopo concedido e as datas.
 *  - `reports`: as denúncias que o titular FEZ (alvo, motivo, status, datas).
 *  - `extractionEvents` e `mealPlanSuggestionEvents`: os registros de uso da Extração de ingredientes e da
 *    Sugestão de cardápio (data; modelo, tokens e custo). Revisa a metade "fora do export" do ADR-0036 dec.7.
 *  - `creationSessions[].generations[]`: tokens, custo, `promptStamp` (só versão e rótulos dos eixos, ver
 *    `exportablePromptStamp`) e a variação escolhida.
 *
 * NUNCA entra (de propósito):
 *  - Credenciais: `session.token` (credencial ao portador) nem `session.id`; da tabela `account`, a senha e
 *    os tokens (`password`, `accessToken`, `refreshToken`, `idToken`) nem as validades dos tokens;
 *    `verification` (tokens de e-mail/senha).
 *  - Ids de Curador ou moderador (terceiros): `moderatedBy`, `imageGenBlockedBy`, `report.resolvedBy`.
 *  - O texto de prompt escrito por admin ou Curador que fica no `promptStamp` (`variacaoDivergente.instrucao`,
 *    `vozCozinha.notaCurada`): não é dado do titular.
 *  - As denúncias que OUTRAS pessoas fizeram sobre o conteúdo do titular (quem denunciou é escolha de
 *    terceiro, mesma regra da lista de seguidores).
 *  - Colunas internas da imagem (`reviewRequired`, `derivativesAttemptedAt`) e a `lineageId` (chave interna).
 *  - `rate_limit` (chaveado por IP, não pelo titular) e `dsar_audit_event` (o registro de conformidade).
 *
 * Portável/legível: JSON plano e versionado (`format`), pronto para o titular ler ou reimportar. A versão
 * segue `v1`: as seções novas só ACRESCENTAM chaves (nada renomeado nem com tipo trocado), como nos PRs
 * anteriores que estenderam o export.
 *
 * Em STREAMING (#595): `accountExportSections` é um gerador que consulta e entrega UMA seção de topo por
 * vez, na ordem do arquivo; o route as escreve com `jsonObjectChunks` conforme ficam prontas. Assim o corpo
 * nunca passa inteiro pela memória numa string só, nem esbarra no teto de 4,5 MB da resposta de função da
 * Vercel (umas 330 receitas já passariam disso).
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

/**
 * As seções do export, na ordem do arquivo; cada uma consulta o banco só quando é pedida. `now` vira o
 * `exportedAt` (o route usa o mesmo instante no nome do `Content-Disposition`).
 */
export async function* accountExportSections(
  db: Database,
  userId: string,
  now: Date = new Date(),
): AsyncGenerator<JsonObjectSection> {
  // ── Perfil (dados de conta do próprio titular) ────────────────────────────────
  const [profileRow] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      handle: users.handle,
      bio: users.bio,
      links: users.links,
      locale: users.locale,
      // Nível de habilidade padrão (#421).
      nivelPadrao: users.nivelPadrao,
      // Restrições salvas (ADR-0041 — dado sensível, LGPD Art. 11; o titular tem acesso a ele aqui).
      restricoes: users.restricoes,
      // ...e quando e com qual versão do texto a pessoa consentiu (#600).
      restricoesConsentidasEm: users.restricoesConsentidasEm,
      restricoesConsentimentoVersao: users.restricoesConsentimentoVersao,
      image: users.image,
      role: users.role,
      // #595: o plano comercial (#466) e as sanções sobre a conta. Sem o `imageGenBlockedBy` (id do Curador).
      plan: users.plan,
      banned: users.banned,
      banReason: users.banReason,
      banExpires: users.banExpires,
      imageGenBlockedAt: users.imageGenBlockedAt,
      imageGenBlockedReason: users.imageGenBlockedReason,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      // Os básicos da Despensa (ADR-0042) saem do perfil para a seção da Despensa, logo abaixo.
      pantryBasics: users.pantryBasics,
    })
    .from(users)
    .where(eq(users.id, userId))
  // `null` = nunca mexeu (vale a lista padrão do app). Fora de `account`, junto da Despensa.
  const { pantryBasics = null, ...account } = profileRow ?? {}

  yield ['format', EXPORT_FORMAT]
  yield ['exportedAt', now.toISOString()]
  yield ['account', profileRow ? account : null]

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
      // #595: a capa (id opaco; ver o docstring sobre `recipeImages`).
      imageId: recipe.imageId,
      // #595: a moderação da receita (saiu do pool, quando e por quê). Sem o `moderatedBy` (id do Curador).
      moderationRemovedAt: recipe.moderationRemovedAt,
      moderationReason: recipe.moderationReason,
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
  yield [
    'recipes',
    recipeRows.map(({ id, ...rest }) => ({
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
    })),
  ]

  // ── #595: imagens que o titular enviou ou gerou. Sem o `moderatedBy`, as colunas internas nem a
  //    `lineageId`. Anda por `recipe_image_created_by_idx` (#601). ─────────────────────────────────────
  yield [
    'recipeImages',
    await db
      .select({
        id: recipeImage.id,
        provenance: recipeImage.provenance,
        sourceImageId: recipeImage.sourceImageId,
        blobUrl: recipeImage.blobUrl,
        detailUrl: recipeImage.detailUrl,
        thumbUrl: recipeImage.thumbUrl,
        moderatedAt: recipeImage.moderatedAt,
        moderatedReason: recipeImage.moderatedReason,
        createdAt: recipeImage.createdAt,
      })
      .from(recipeImage)
      .where(eq(recipeImage.createdBy, userId))
      .orderBy(asc(recipeImage.createdAt), asc(recipeImage.id)),
  ]

  // ── Avaliações escritas pelo titular (#595: com a moderação, sem o id do Curador) ─────────────────
  yield [
    'reviews',
    await db
      .select({
        recipeId: recipeReview.recipeId,
        rating: recipeReview.rating,
        comment: recipeReview.comment,
        photoUrl: recipeReview.photoUrl,
        moderatedAt: recipeReview.moderatedAt,
        moderatedReason: recipeReview.moderatedReason,
        createdAt: recipeReview.createdAt,
        updatedAt: recipeReview.updatedAt,
      })
      .from(recipeReview)
      .where(eq(recipeReview.userId, userId))
      .orderBy(asc(recipeReview.createdAt)),
  ]

  // ── #595: denúncias que o titular FEZ. Sem `resolvedBy` (id do Curador, terceiro). ─────────────────
  yield [
    'reports',
    await db
      .select({
        recipeId: report.recipeId,
        reviewId: report.reviewId,
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt,
        resolvedAt: report.resolvedAt,
      })
      .from(report)
      .where(eq(report.reporterId, userId))
      .orderBy(asc(report.createdAt)),
  ]

  // ── Receitas salvas ──────────────────────────────────────────────────────────
  yield [
    'savedRecipes',
    await db
      .select({ recipeId: recipeSave.recipeId, savedAt: recipeSave.createdAt })
      .from(recipeSave)
      .where(eq(recipeSave.userId, userId))
      .orderBy(asc(recipeSave.createdAt)),
  ]

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
  yield [
    'collections',
    collectionRows.map((c) => ({
      id: c.id,
      name: c.name,
      createdAt: c.createdAt,
      recipeIds: (itemsByCollection.get(c.id) ?? []).map((i) => i.recipeId),
    })),
  ]

  // ── Listas de compras (ADR-0032) + itens — conteúdo privado do titular ─────────────
  const shoppingListRows = await db
    .select({ id: shoppingList.id, name: shoppingList.name, createdAt: shoppingList.createdAt })
    .from(shoppingList)
    .where(eq(shoppingList.userId, userId))
    .orderBy(asc(shoppingList.createdAt))
  const shoppingListIds = shoppingListRows.map((l) => l.id)
  const shoppingListItemRows =
    shoppingListIds.length > 0
      ? await db
          .select({
            listId: shoppingListItem.listId,
            nome: shoppingListItem.nome,
            quantidade: shoppingListItem.quantidade,
            unidade: shoppingListItem.unidade,
            sourceRecipeId: shoppingListItem.sourceRecipeId,
            checkedAt: shoppingListItem.checkedAt,
            createdAt: shoppingListItem.createdAt,
          })
          .from(shoppingListItem)
          .where(inArray(shoppingListItem.listId, shoppingListIds))
          .orderBy(asc(shoppingListItem.createdAt), asc(shoppingListItem.id))
      : []
  const itemsByShoppingList = groupBy(shoppingListItemRows, (r) => r.listId)
  yield [
    'shoppingLists',
    shoppingListRows.map((l) => ({
      id: l.id,
      name: l.name,
      createdAt: l.createdAt,
      items: (itemsByShoppingList.get(l.id) ?? []).map((i) => ({
        nome: i.nome,
        quantidade: i.quantidade,
        unidade: i.unidade,
        sourceRecipeId: i.sourceRecipeId,
        checkedAt: i.checkedAt,
        createdAt: i.createdAt,
      })),
    })),
  ]

  // ── Plano de refeições (ADR-0035) — com as Anotações livres (ADR-0037), texto do próprio titular ──
  yield [
    'mealPlan',
    await db
      .select({
        day: mealPlanEntry.day,
        slot: mealPlanEntry.slot,
        recipeId: mealPlanEntry.recipeId,
        note: mealPlanEntry.note,
        porcoes: mealPlanEntry.porcoes,
        createdAt: mealPlanEntry.createdAt,
      })
      .from(mealPlanEntry)
      .where(eq(mealPlanEntry.userId, userId))
      .orderBy(asc(mealPlanEntry.day), asc(mealPlanEntry.createdAt)),
  ]

  // ── Despensa (ADR-0038): os nomes que o próprio titular digitou, e os básicos dele (ADR-0042) ─────
  yield [
    'pantry',
    await db
      .select({ nome: pantryItem.nome, createdAt: pantryItem.createdAt })
      .from(pantryItem)
      .where(eq(pantryItem.userId, userId))
      .orderBy(asc(pantryItem.createdAt)),
  ]
  yield ['pantryBasics', pantryBasics]

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
  yield [
    'social',
    {
      followingCount: followingRows.length,
      followersCount,
      following: followingRows,
    },
  ]

  // ── Notificações (a caixa do titular): tipo + timestamps + refs. SEM identidade do ator. ─────
  //    #609: com a categoria do motivo das retiradas (o código da lista fechada que a pessoa vê na caixa; null nos
  //    demais tipos). Nunca o texto livre do Curador nem quem decidiu, que não estão na notificação.
  yield [
    'notifications',
    await db
      .select({
        type: notification.type,
        recipeId: notification.recipeId,
        reviewId: notification.reviewId,
        moderationCategory: notification.moderationCategory,
        readAt: notification.readAt,
        createdAt: notification.createdAt,
      })
      .from(notification)
      .where(eq(notification.recipientId, userId))
      .orderBy(asc(notification.createdAt)),
  ]

  // ── #595: acessos. NUNCA o `token` (credencial ao portador) nem o `id` da sessão. ─────────────────
  yield [
    'loginSessions',
    await db
      .select({
        createdAt: loginSession.createdAt,
        updatedAt: loginSession.updatedAt,
        expiresAt: loginSession.expiresAt,
        ipAddress: loginSession.ipAddress,
        userAgent: loginSession.userAgent,
      })
      .from(loginSession)
      .where(eq(loginSession.userId, userId))
      .orderBy(asc(loginSession.createdAt)),
  ]

  // ── #595: os jeitos de entrar (senha, Google). Lista FECHADA de colunas: nunca a senha (hash), os
  //    tokens OAuth (`accessToken`, `refreshToken`, `idToken`) nem as validades deles. ─────────────────
  yield [
    'logins',
    await db
      .select({
        provider: authAccount.providerId,
        accountId: authAccount.accountId,
        scope: authAccount.scope,
        createdAt: authAccount.createdAt,
        updatedAt: authAccount.updatedAt,
      })
      .from(authAccount)
      .where(eq(authAccount.userId, userId))
      .orderBy(asc(authAccount.createdAt)),
  ]

  // ── Ledger de geração de imagem por IA (custo/tokens do próprio titular) ──────
  yield [
    'imageGenerations',
    await db
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
      .orderBy(asc(imageGeneration.createdAt)),
  ]

  // ── #595: registros de uso. Extração: só a data, em objetos (não strings soltas) para a forma poder
  //    crescer. Sugestão de cardápio: o ledger não guarda conteúdo (ADR-0036 dec.7), só modelo, tokens e custo.
  yield [
    'extractionEvents',
    await db
      .select({ createdAt: extractionEvent.createdAt })
      .from(extractionEvent)
      .where(eq(extractionEvent.userId, userId))
      .orderBy(asc(extractionEvent.createdAt)),
  ]
  yield [
    'mealPlanSuggestionEvents',
    await db
      .select({
        model: mealPlanSuggestionEvent.model,
        inputTokens: mealPlanSuggestionEvent.inputTokens,
        outputTokens: mealPlanSuggestionEvent.outputTokens,
        costUsd: mealPlanSuggestionEvent.costUsd,
        createdAt: mealPlanSuggestionEvent.createdAt,
      })
      .from(mealPlanSuggestionEvent)
      .where(eq(mealPlanSuggestionEvent.userId, userId))
      .orderBy(asc(mealPlanSuggestionEvent.createdAt)),
  ]

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
            // #595: o custo da geração e o que a produziu (versão do prompt, variação escolhida pelo titular).
            inputTokens: generation.inputTokens,
            outputTokens: generation.outputTokens,
            costUsd: generation.costUsd,
            promptStamp: generation.promptStamp,
            variantLabel: generation.variantLabel,
            variantChosen: generation.variantChosen,
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

  yield [
    'creationSessions',
    sessionRows.map((s) => {
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
          inputTokens: gn.inputTokens,
          outputTokens: gn.outputTokens,
          costUsd: gn.costUsd,
          // Só versão e rótulos dos eixos: o texto de prompt de admin/Curador não sai (ver o docstring).
          promptStamp: exportablePromptStamp(gn.promptStamp),
          variantLabel: gn.variantLabel,
          variantChosen: gn.variantChosen,
          createdAt: gn.createdAt,
        })),
        transcript: (transcriptBySession.get(s.id) ?? []).map((m) => ({
          role: m.role,
          content: m.content,
          seq: m.seq,
          createdAt: m.createdAt,
        })),
      }
    }),
  ]
}
