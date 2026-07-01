import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeReview, users } from '@/db/schema'
import { decideReview } from '@/domain/review'
import { eligibleForPool } from '@/domain/recipe-pool'
import type { CurationStatus } from '@/domain/recipe-curation'
import type { ImageStore } from '@/server/images/image-store'
import { emitNotification } from '@/server/notification'

/**
 * Núcleo com efeito da AVALIAÇÃO (issue #363, ADR-0027). Espelha `social.ts`: discriminated
 * unions que o route mapeia para HTTP — rotas finas e DRY.
 *
 * GATE DE POOL, NÃO de ownership (como voto/favorito): o Catálogo é PÚBLICO e DEVE ser
 * avaliável. O gate (`loadReviewGate`) replica o gate de LEITURA canônico do GET/search via
 * `eligibleForPool` (fonte única) — receita privada de outro/playful/web_imported/rascunho de
 * catálogo ⇒ not_found (404, não vaza existência). O gate DISPARA ANTES de qualquer checagem
 * de nota/auto-avaliação/comentário, pra o erro nunca revelar existência por um código distinto.
 *
 * AC (auto-avaliação): `applyReview` é o ÚNICO escritor de `recipe_review` e o único a chamar
 * `decideReview`. Como NÃO há CHECK no banco (owner_id é cross-table), qualquer FUTURO segundo
 * escritor (ex.: o emit da notificação #371) DEVE também chamar `decideReview`.
 *
 * UNICIDADE (1 por par): `INSERT ... ON CONFLICT (user_id, recipe_id) DO UPDATE` — re-avaliar
 * EDITA a linha (nota/comentário novos), inclusive sob concorrência (colidem na UNIQUE).
 *
 * MÉDIA/CONTAGEM (`loadAggregate`): agregado CRU (NÃO Bayesiano — isso é #368) sobre as linhas
 * VIVAS (autor não soft-deletado + `moderated_at IS NULL`). `avg(...)::float8` é OBRIGATÓRIO:
 * postgres-js devolve `numeric`/`avg` como STRING (todo agregado do repo casta); float8
 * preserva NULL-em-zero-linhas ⇒ `average: number | null` se mantém.
 */

type Gate = {
  ownerId: string | null
  visibility: string
  resultKind: string
  moderationRemovedAt: Date | null
  origin: string
  // eligibleForPool EXIGE curationStatus (#238) — sem ele o gate não tipa.
  curationStatus: CurationStatus
}

/** Linha PÚBLICA de uma Avaliação — allowlist mínima (sem user_id/moderated_at/ids internos). */
export type ReviewView = {
  id: string
  rating: number
  comment: string | null
  // #365 (ADR-0027): FOTO opcional do prato (upload/câmera, NUNCA IA). URL pública do blob no
  // `ImageStore` — nunca vira `recipe_image`/`lineage_id`/proveniência; é do AVALIADOR, não do dono.
  photoUrl: string | null
  author: { name: string | null; handle: string | null }
  createdAt: Date
}

/**
 * #365: descritor do que fazer com a FOTO no upsert da avaliação. Evita a ambiguidade
 * undefined/null: `keep` mantém a foto atual (edição de nota/comentário sem tocar a foto);
 * `set` grava os bytes JÁ LIMPOS (re-encodados server-side, sem EXIF/GPS) que a rota passou;
 * `clear` remove a foto. O route mapeia o multipart pra este descritor.
 */
export type ReviewPhoto =
  | { kind: 'keep' }
  | { kind: 'set'; data: Buffer; contentType: string }
  | { kind: 'clear' }

export type ReviewResult =
  | {
      kind: 'ok'
      average: number | null
      count: number
      viewerRating: number | null
      viewerComment: string | null
      // #365 — o BLOB é gerido pela rota (best-effort, só o que é NOSSO). No SAVE: `prevPhotoUrl`
      // (foto antes do upsert) + `finalPhotoUrl` (foto após) ⇒ a rota apaga a superseded se mudou.
      // No DELETE: `deletedPhotoUrl` (foto da linha REALMENTE apagada; null se no-op/moderada ⇒ blob fica).
      prevPhotoUrl: string | null
      finalPhotoUrl: string | null
      deletedPhotoUrl: string | null
    } // 200
  | { kind: 'not_found' } //       404 — inexistente / fora do pool
  | { kind: 'auto_review' } //     422 — avaliar a própria
  | { kind: 'invalid_rating' } //  400
  | { kind: 'invalid_comment' } // 400
  | { kind: 'storage_error' } //   503 — o ImageStore falhou; a avaliação NÃO foi mutada

/**
 * Gate barato + elegibilidade de POOL — devolve o `Gate` quando a Receita está no pool
 * (avaliável); `null` quando inexistente OU fora do pool. Cópia VERBATIM de `social.ts
 * loadPoolGate` (não importado de lá pra evitar contenção com a fatia #362). MESMO predicado
 * (`eligibleForPool`), fonte única compartilhada.
 */
async function loadReviewGate(db: Database, id: string): Promise<Gate | null> {
  const [gate] = await db
    .select({
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      resultKind: recipe.resultKind,
      moderationRemovedAt: recipe.moderationRemovedAt,
      origin: recipe.origin,
      curationStatus: recipe.curationStatus,
    })
    .from(recipe)
    .where(eq(recipe.id, id))
  if (!gate) return null
  return eligibleForPool(gate) ? gate : null
}

/**
 * Média (crua) + contagem das Avaliações VIVAS da Receita. INNER JOIN `users` +
 * `isNull(deletedAt)` exclui autores desativados do agregado E da lista (todo read social
 * público filtra `deleted_at`); `moderated_at IS NULL` aplica o seam de moderação (#366).
 * `avg(...)::float8` → número real (NULL em zero linhas); `count(*)::int` → número (não string).
 */
async function loadAggregate(
  db: Database,
  id: string,
): Promise<{ average: number | null; count: number }> {
  const [row] = await db
    .select({
      average: sql<number | null>`avg(${recipeReview.rating})::float8`,
      count: sql<number>`count(*)::int`,
    })
    .from(recipeReview)
    .innerJoin(users, eq(users.id, recipeReview.userId))
    .where(
      and(
        eq(recipeReview.recipeId, id),
        isNull(recipeReview.moderatedAt),
        isNull(users.deletedAt),
      ),
    )
  return { average: row?.average ?? null, count: row?.count ?? 0 }
}

export async function applyReview(input: {
  db: Database
  id: string // já validado como uuid pelo route
  userId: string // session.user.id (route já passou pelo requireSession)
  action: 'save' | 'delete'
  rating?: number
  comment?: unknown
  // #365: descritor da FOTO (default `keep`). `set` traz os bytes JÁ LIMPOS (a rota re-encoda via
  // sharp, sem EXIF/GPS). O store é feito AQUI (pós-gate) — save rejeitado nunca queima o storage.
  photo?: ReviewPhoto
  // #365: seam de storage (getImageStore()). Só o SAVE-com-foto usa; delete/keep/clear não tocam.
  store?: ImageStore
}): Promise<ReviewResult> {
  const { db, id, userId, action } = input

  const gate = await loadReviewGate(db, id)
  if (!gate) return { kind: 'not_found' }

  if (action === 'save') {
    const d = decideReview({
      reviewerId: userId,
      recipeOwnerId: gate.ownerId,
      rating: input.rating ?? NaN,
      comment: input.comment,
    })
    if (!d.allowed) return { kind: d.reason }

    const photo: ReviewPhoto = input.photo ?? { kind: 'keep' }
    const store = input.store

    // C4: a foto ANTERIOR vem de um SELECT prévio (o RETURNING do upsert só daria a linha PÓS-op).
    const [existing] = await db
      .select({ photoUrl: recipeReview.photoUrl })
      .from(recipeReview)
      .where(and(eq(recipeReview.userId, userId), eq(recipeReview.recipeId, id)))
      .limit(1)
    const prevPhotoUrl = existing?.photoUrl ?? null

    // C2: o STORE roda SÓ AQUI — depois do gate de pool E do decideReview. Um save rejeitado
    // (auto_review / fora do pool / nota inválida) NUNCA armazena um blob (zero churn/órfão).
    // Falha do store ⇒ `storage_error` (503) ANTES de qualquer mutação ⇒ a avaliação fica intacta.
    let storedUrl: string | null = null
    if (photo.kind === 'set') {
      if (!store) throw new Error('applyReview: store obrigatório para anexar foto à avaliação')
      try {
        ;({ url: storedUrl } = await store.store({
          data: photo.data,
          contentType: 'image/webp',
          pathPrefix: 'reviews',
        }))
      } catch {
        return { kind: 'storage_error' }
      }
    }

    // Valor final da coluna: keep→prev (não muda); set→a URL recém-gravada; clear→null.
    const finalPhotoUrl = photo.kind === 'keep' ? prevPhotoUrl : storedUrl

    // C3: o set do upsert monta por SPREAD (o objeto mutável não tipa). keep ⇒ NÃO inclui photoUrl
    // (mantém a existente); set/clear ⇒ inclui o valor final. INSERT fresco: keep/clear nascem null.
    // #374: o RETURNING dá o `reviewId` da linha upsertada (criação OU edição), para ancorar a
    // notificação `review_on_recipe` (só na criação — ver abaixo).
    let reviewId: string
    // #374: `wasInsert` = a linha foi CRIADA (não editada), derivado ATOMICAMENTE do próprio upsert
    // via `xmax = 0` (idioma Postgres: linha recém-inserida tem xmax 0; ON CONFLICT DO UPDATE deixa
    // xmax != 0). É a fonte da decisão de notificar — o SELECT `existing` acima (para `prevPhotoUrl`)
    // roda antes do commit e, sob double-submit concorrente, os dois veriam `undefined` e notificariam
    // em dobro; `xmax` fecha essa corrida numa única sentença.
    let wasInsert: boolean
    try {
      const [upserted] = await db
        .insert(recipeReview)
        .values({
          userId,
          recipeId: id,
          rating: input.rating!,
          comment: d.comment,
          photoUrl: photo.kind === 'set' ? storedUrl : null,
        })
        .onConflictDoUpdate({
          target: [recipeReview.userId, recipeReview.recipeId],
          set: {
            rating: input.rating!,
            comment: d.comment,
            updatedAt: sql`now()`,
            ...(photo.kind !== 'keep' ? { photoUrl: finalPhotoUrl } : {}),
          },
        })
        .returning({ id: recipeReview.id, inserted: sql<boolean>`(xmax = 0)` })
      reviewId = upserted.id
      wasInsert = upserted.inserted
    } catch (err) {
      // Órfão residual (erro de DB APÓS o store bem-sucedido, raro): apaga best-effort o blob
      // recém-criado e re-lança (a rota vira 500 cru; nada foi persistido).
      if (storedUrl && store?.owns(storedUrl)) {
        try {
          await store.delete(storedUrl)
        } catch {
          // órfão tolerável.
        }
      }
      throw err
    }

    // #374: NOVA avaliação → notifica o DONO da receita, best-effort, SÓ NA CRIAÇÃO (`wasInsert`,
    // derivado atomicamente do upsert — edição não re-notifica, nem sob double-submit concorrente).
    // Pula o catálogo (`ownerId === null`, sem destinatário). `decideReview` já garantiu avaliador≠dono
    // ⇒ o destinatário nunca é o próprio. Fora de qualquer transação (o upsert já persistiu);
    // `emitNotification` engole erro (a avaliação NUNCA falha por causa da notificação). `actorId =
    // userId` (o avaliador PODE mostrar o nome).
    if (wasInsert && gate.ownerId !== null) {
      await emitNotification(db, {
        recipientId: gate.ownerId,
        type: 'review_on_recipe',
        actorId: userId,
        recipeId: id,
        reviewId,
      })
    }

    const agg = await loadAggregate(db, id)
    return {
      kind: 'ok',
      ...agg,
      viewerRating: input.rating!,
      viewerComment: d.comment,
      prevPhotoUrl,
      finalPhotoUrl,
      deletedPhotoUrl: null,
    }
  }

  // delete: sem checagem de nota/auto/comentário; idempotente (no-op se não existe). Ainda
  // pool-gated (fora do pool ⇒ 404), consistente com `unvote` — as avaliações PERSISTEM
  // através de despublicar (o gate 404 nesse caso é intencional, não apaga a linha).
  //
  // #366 (M4): a avaliação MODERADA pelo Curador NÃO é apagável pelo autor — `isNull(moderatedAt)`
  // no WHERE torna o delete um NO-OP sobre uma linha moderada. Sem isso, o autor apagaria a linha
  // (junto com moderated_*) e re-postaria pra ressuscitar (o upsert nasce moderated_at NULL),
  // derrotando a moderação. A moderação é DURÁVEL (in-model, como recipe/recipe_image). Avaliação
  // não-moderada apaga normal.
  //
  // #365 (C11): o `.returning({ photoUrl })` devolve a linha REALMENTE apagada — `null` quando o
  // delete foi no-op (não existia OU moderada). A rota só apaga o blob quando `deletedPhotoUrl`
  // veio preenchido (linha não-moderada apagada); em moderada a foto persiste oculta (como #366).
  const [deleted] = await db
    .delete(recipeReview)
    .where(and(eq(recipeReview.userId, userId), eq(recipeReview.recipeId, id), isNull(recipeReview.moderatedAt)))
    .returning({ photoUrl: recipeReview.photoUrl })
  const deletedPhotoUrl = deleted?.photoUrl ?? null
  const agg = await loadAggregate(db, id)
  return {
    kind: 'ok',
    ...agg,
    viewerRating: null,
    viewerComment: null,
    prevPhotoUrl: null,
    finalPhotoUrl: null,
    deletedPhotoUrl,
  }
}

/** Cap SERVER-controlled da lista (paginação por cursor deferida). Protege o payload SSR/GET. */
const REVIEW_LIST_LIMIT = 50

/**
 * Leitura COOKIE-FREE do agregado + lista de Avaliações — SEM dado do viewer. Devolve `null`
 * quando fora do pool (chama `loadReviewGate` ⇒ doubles como gate leak-safe: o caller 404 sem
 * uma segunda query). O agregado é o VERDADEIRO (sobre TODAS as linhas vivas, sem LIMIT); a
 * lista é capada em `REVIEW_LIST_LIMIT`. `average` é a MÉDIA crua (NÃO Bayesiano — isso é #368).
 */
export async function loadRecipeReviews(
  db: Database,
  { id }: { id: string },
): Promise<{ average: number | null; count: number; reviews: ReviewView[] } | null> {
  const gate = await loadReviewGate(db, id)
  if (!gate) return null

  const agg = await loadAggregate(db, id)
  const rows = await db
    .select({
      id: recipeReview.id,
      rating: recipeReview.rating,
      comment: recipeReview.comment,
      photoUrl: recipeReview.photoUrl,
      authorName: users.name,
      authorHandle: users.handle,
      createdAt: recipeReview.createdAt,
    })
    .from(recipeReview)
    .innerJoin(users, eq(users.id, recipeReview.userId))
    .where(and(eq(recipeReview.recipeId, id), isNull(recipeReview.moderatedAt), isNull(users.deletedAt)))
    .orderBy(desc(recipeReview.createdAt))
    .limit(REVIEW_LIST_LIMIT)

  const reviews: ReviewView[] = rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    photoUrl: r.photoUrl,
    author: { name: r.authorName, handle: r.authorHandle },
    createdAt: r.createdAt,
  }))
  return { average: agg.average, count: agg.count, reviews }
}

export type ViewerReviewResult =
  | {
      kind: 'ok'
      // #366: `id` da PRÓPRIA avaliação do viewer (viewer-scoped, leak-safe — gateado por sessão) para
      // a UI esconder o "Reportar" na própria linha da lista pública (o autor edita/apaga, não reporta).
      // #365: `photoUrl` prefilla o preview da foto ao editar a própria avaliação.
      viewerReview: { id: string; rating: number; comment: string | null; photoUrl: string | null } | null
      isOwner: boolean
      // #366: a própria avaliação foi MODERADA (removida pelo Curador). NÃO filtramos a linha (o autor
      // ainda precisa saber que existe), mas a UI troca o widget editável por um aviso só-leitura — o
      // delete é no-op durável no servidor (M4), então não oferecemos a ação que mente.
      moderated: boolean
    }
  | { kind: 'not_found' } // 404 — inexistente / fora do pool (leak-safe)

/**
 * Estado da PRÓPRIA Avaliação do viewer — leitura per-viewer que o caminho PÚBLICO/cacheável
 * do detalhe (lê anônimo, sem cookie) não entrega. MESMO gate leak-safe (404 fora do pool).
 * `userId` é HARD-WIRED da sessão (anti-IDOR — nunca de query/body); nunca vaza a avaliação
 * alheia. `isOwner` deixa a UI esconder o widget do dono (auto-avaliação barrada).
 */
export async function loadViewerReview(
  db: Database,
  { id, userId }: { id: string; userId: string },
): Promise<ViewerReviewResult> {
  const gate = await loadReviewGate(db, id)
  if (!gate) return { kind: 'not_found' }

  const [row] = await db
    .select({
      id: recipeReview.id,
      rating: recipeReview.rating,
      comment: recipeReview.comment,
      photoUrl: recipeReview.photoUrl,
      moderatedAt: recipeReview.moderatedAt,
    })
    .from(recipeReview)
    .where(and(eq(recipeReview.userId, userId), eq(recipeReview.recipeId, id)))
    .limit(1)

  return {
    kind: 'ok',
    viewerReview: row
      ? { id: row.id, rating: row.rating, comment: row.comment, photoUrl: row.photoUrl }
      : null,
    isOwner: gate.ownerId === userId,
    moderated: row?.moderatedAt != null,
  }
}
