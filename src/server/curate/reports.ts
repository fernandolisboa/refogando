import { eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Database } from '@/db/client'
import { recipe, recipeReview, report, users } from '@/db/schema'

/**
 * Fila de Reports do Curador (issue #18/#366, AC1) — leitura PURA dos reports `pending`,
 * ordenados por data de criação (mais antigos primeiro). Espelha `curate/translations/stale`
 * (sem paginação, só metadados; enums em inglês — i18n visível mora na UI).
 *
 * POLIMORFISMO DE ALVO (#366): um report mira a RECEITA **ou** uma AVALIAÇÃO. LEFT JOINs (não
 * INNER) para NÃO dropar o alvo nulo do outro tipo. `ReportQueueItem` é uma união DISCRIMINADA
 * por `target`: o alvo-receita mantém os campos FLAT de hoje (recipeId/origin/resultKind/ownerId/
 * ownerImageGenBlocked — usados por #226 e pelos testes existentes); o alvo-avaliação carrega o
 * CONTEÚDO (nota+comentário+autor) pra o Curador JULGAR — a rota é gateada por requireRole('curador').
 *
 * Esta é uma VISÃO DE MODERAÇÃO do Curador, não o pool público: pode listar reports de Receitas já
 * removidas. `reporterId` é exposto SÓ ao Curador (a rota é gateada).
 */
export type ReportQueueItem =
  | {
      target: 'recipe'
      id: string
      recipeId: string
      reason: string
      origin: string
      resultKind: string
      reporterId: string
      status: string
      createdAt: Date
      /**
       * Dono da Receita reportada (#226) — `null` para Catálogo (receita editorial sem dono). LEFT JOIN
       * users em recipe.owner_id. A UI só oferece a ação "bloquear/desbloquear geração-de-imagem do autor"
       * quando há um dono. É o ALVO do `POST .../users/[ownerId]/image-gen-restriction`.
       */
      ownerId: string | null
      /**
       * O dono já está com a geração-de-imagem-por-IA BLOQUEADA pelo Curador (#226)? Alterna o rótulo
       * da ação. `false` quando não há dono (Catálogo) ou o dono está liberado. Derivado de
       * `users.image_gen_blocked_at IS NOT NULL`.
       */
      ownerImageGenBlocked: boolean
    }
  | {
      target: 'review'
      id: string
      reason: string
      reporterId: string
      status: string
      createdAt: Date
      /**
       * Conteúdo da Avaliação reportada (#366) — mostrado AO CURADOR pra julgar (rota gateada). Allowlist:
       * SEM user_id cru / moderated_* na payload; `authorName`/`authorHandle` do autor (LEFT JOIN aliased).
       */
      review: {
        id: string
        recipeId: string
        rating: number
        comment: string | null
        // #365: FOTO reportável — mostrada AO CURADOR (rota gated, não é leak público) pra ele julgar
        // e remover com visibilidade. `null` quando a avaliação não tem foto.
        photoUrl: string | null
        authorName: string | null
        authorHandle: string | null
      }
    }

export async function listReportQueue(db: Database): Promise<ReportQueueItem[]> {
  // 2º JOIN de `users` exige alias (drizzle): `users` é o DONO da receita (#226), `author` é o
  // AUTOR da avaliação (#366). São pessoas distintas em geral.
  const author = alias(users, 'author')

  const rows = await db
    .select({
      id: report.id,
      reason: report.reason,
      reporterId: report.reporterId,
      status: report.status,
      createdAt: report.createdAt,
      // alvo-receita
      recipeId: report.recipeId,
      origin: recipe.origin,
      resultKind: recipe.resultKind,
      ownerId: recipe.ownerId,
      // Bloqueado = `image_gen_blocked_at ≠ null`. LEFT JOIN ⇒ `at` é null quando não há dono (Catálogo).
      ownerBlockedAt: users.imageGenBlockedAt,
      // alvo-avaliação
      reviewId: report.reviewId,
      reviewRecipeId: recipeReview.recipeId,
      reviewRating: recipeReview.rating,
      reviewComment: recipeReview.comment,
      reviewPhotoUrl: recipeReview.photoUrl,
      authorName: author.name,
      authorHandle: author.handle,
    })
    .from(report)
    // LEFT JOINs (NÃO inner): cada report mira exatamente UM alvo (CHECK); o outro lado fica nulo.
    .leftJoin(recipe, eq(recipe.id, report.recipeId))
    .leftJoin(recipeReview, eq(recipeReview.id, report.reviewId))
    // Catálogo não tem dono (owner_id NULL) — o item ainda aparece, sem ação de bloqueio.
    .leftJoin(users, eq(users.id, recipe.ownerId))
    .leftJoin(author, eq(author.id, recipeReview.userId))
    .where(eq(report.status, 'pending'))
    .orderBy(report.createdAt)

  return rows.map((r): ReportQueueItem => {
    // Discrimina pelo alvo não-nulo (o CHECK garante exatamente um).
    if (r.reviewId != null) {
      return {
        target: 'review',
        id: r.id,
        reason: r.reason,
        reporterId: r.reporterId,
        status: r.status,
        createdAt: r.createdAt,
        review: {
          id: r.reviewId,
          recipeId: r.reviewRecipeId as string,
          rating: r.reviewRating as number,
          comment: r.reviewComment,
          photoUrl: r.reviewPhotoUrl,
          authorName: r.authorName,
          authorHandle: r.authorHandle,
        },
      }
    }
    return {
      target: 'recipe',
      id: r.id,
      recipeId: r.recipeId as string,
      reason: r.reason,
      origin: r.origin as string,
      resultKind: r.resultKind as string,
      reporterId: r.reporterId,
      status: r.status,
      createdAt: r.createdAt,
      ownerId: r.ownerId,
      ownerImageGenBlocked: r.ownerBlockedAt != null,
    }
  })
}
