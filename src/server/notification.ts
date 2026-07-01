import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { notification, users } from '@/db/schema'
import type { NotificationType, NotificationRefs } from '@/domain/notification'

/**
 * Seam da Caixa de Notificações (#371, ADR-0028). Escrita = `emitNotification` (BEST-EFFORT: falhar a
 * notificação NUNCA falha a ação de origem). Leitura = `loadNotifications` (só-logado, anti-IDOR, dado
 * VIVO — a identidade do ator é lida na hora e degrada se ele foi soft-deletado). `markRead` marca
 * lido em lote (ao abrir) ou por item. Nada de coluna de texto: o DTO carrega refs estruturadas e a
 * vista chama `renderNotification` no locale do leitor.
 */

/** UUID canônico — valida um id ANTES de bindá-lo `::uuid` (id forjado → `invalid input syntax`/500). */
const CURSOR_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Quantas notificações a página do painel devolve. SERVER-controlled (a rota nunca lê `?limit=`). */
export const NOTIFICATIONS_PAGE_SIZE = 20

/** O par keyset por trás do cursor: `created_at` em TEXTO de precisão-cheia + o id da própria linha. */
type NotificationCursor = { ts: string; id: string }

/**
 * Codifica o cursor: base64url de `${created_at::text}|${id}`. O `created_at` vai em TEXTO (micros
 * incluídos) — um `Date.toISOString()` truncaria pra ms e perderia linhas no boundary. Espelho literal
 * do cursor de `follow.ts` (#307); o desempate é a uuid da PRÓPRIA linha de notificação.
 */
export function encodeNotificationCursor({ ts, id }: NotificationCursor): string {
  return Buffer.from(`${ts}|${id}`, 'utf8').toString('base64url')
}

/**
 * Decodifica o cursor. Tolerante: qualquer lixo (base64 inválido, sem separador, metade vazia, ts não-
 * parseável, id não-uuid) → `null` ⇒ o chamador trata como PRIMEIRA página, NUNCA lança (um `?cursor=`
 * adulterado não pode dar 500). Valida uuid + data ANTES de devolver (nunca cast `::uuid`/`::timestamptz`
 * quebrado).
 */
export function decodeNotificationCursor(raw: string): NotificationCursor | null {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8')
    const sep = decoded.indexOf('|')
    if (sep <= 0) return null
    const ts = decoded.slice(0, sep)
    const id = decoded.slice(sep + 1)
    if (ts.length === 0 || id.length === 0) return null
    if (!CURSOR_UUID_RE.test(id)) return null
    if (!Number.isFinite(Date.parse(ts))) return null
    return { ts, id }
  } catch {
    return null
  }
}

/** Linha pública de uma notificação (allowlist — NUNCA email/id/role do ator). */
export type NotificationDTO = {
  id: string
  type: NotificationType
  refs: NotificationRefs
  actorImage: string | null
  readAt: string | null
  createdAt: string
}

export type NotificationsPage = {
  notifications: NotificationDTO[]
  unreadCount: number
  nextCursor: string | null
}

/**
 * INSERE uma linha de notificação — BEST-EFFORT (ADR-0028): o corpo inteiro é try/catch; uma falha é
 * logada e ENGOLIDA, nunca relançada, pra que a ação de origem (seguir, avaliar, moderar…) jamais falhe
 * por causa da notificação. Uma notificação por evento (v1).
 */
export async function emitNotification(
  db: Database,
  input: {
    recipientId: string
    type: NotificationType
    actorId?: string | null
    recipeId?: string | null
    reviewId?: string | null
  },
): Promise<void> {
  try {
    await db.insert(notification).values({
      recipientId: input.recipientId,
      type: input.type,
      actorId: input.actorId ?? null,
      recipeId: input.recipeId ?? null,
      reviewId: input.reviewId ?? null,
    })
  } catch (err) {
    // Fora do caminho crítico: a caixa é conveniência, não pode derrubar a ação de origem.
    console.error('[notification] emit falhou (engolido):', err)
  }
}

/**
 * Conta as NÃO-LIDAS do viewer (usa o índice parcial `WHERE read_at IS NULL`). Só as próprias (anti-IDOR).
 */
async function countUnread(db: Database, viewerId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notification)
    .where(and(eq(notification.recipientId, viewerId), isNull(notification.readAt)))
  return row?.count ?? 0
}

/**
 * Página de notificações do viewer (mais recentes primeiro) + contador de não-lidas. SÓ do próprio
 * recipient (anti-IDOR: `recipient_id = viewerId`, nunca de query). LEFT JOIN `users` no ator: a
 * identidade (nome/handle/imagem) é lida VIVA e COLAPSA junta a `null` quando o ator foi soft-deletado
 * (`deleted_at` não-nulo) — a notificação DEGRADA, não some, e não vaza @handle clicável nem avatar de
 * conta desativada (invariante app-wide). KEYSET lossless idêntico ao de `follow.ts`.
 */
export async function loadNotifications(
  db: Database,
  viewerId: string,
  opts: { cursor?: string | null; limit?: number } = {},
): Promise<NotificationsPage> {
  const limit = opts.limit ?? NOTIFICATIONS_PAGE_SIZE

  // Ator VIVO ⇒ os campos; ator soft-deletado ⇒ tudo null (identidade colapsada, degrada não some).
  const aliveActor = sql<string | null>`case when ${users.deletedAt} is null then ${users.name} end`
  const aliveHandle = sql<string | null>`case when ${users.deletedAt} is null then ${users.handle} end`
  const aliveImage = sql<string | null>`case when ${users.deletedAt} is null then ${users.image} end`

  const conditions = [eq(notification.recipientId, viewerId)]
  const decoded = opts.cursor ? decodeNotificationCursor(opts.cursor) : null
  if (decoded) {
    conditions.push(
      sql`(${notification.createdAt} < ${decoded.ts}::timestamptz or (${notification.createdAt} = ${decoded.ts}::timestamptz and ${notification.id} > ${decoded.id}::uuid))`,
    )
  }

  const rows = await db
    .select({
      id: notification.id,
      type: notification.type,
      actorName: aliveActor,
      actorHandle: aliveHandle,
      actorImage: aliveImage,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      // SERVER-ONLY (nunca no DTO): alimenta só o cursor opaco da próxima página.
      cursorTs: sql<string>`${notification.createdAt}::text`,
    })
    .from(notification)
    .leftJoin(users, eq(users.id, notification.actorId))
    .where(and(...conditions))
    .orderBy(desc(notification.createdAt), asc(notification.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const kept = hasMore ? rows.slice(0, limit) : rows
  const notifications: NotificationDTO[] = kept.map((r) => ({
    id: r.id,
    type: r.type,
    refs: { actorName: r.actorName, actorHandle: r.actorHandle, recipeTitle: null },
    actorImage: r.actorImage,
    readAt: r.readAt ? r.readAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }))
  const last = kept[kept.length - 1]
  const nextCursor =
    hasMore && last ? encodeNotificationCursor({ ts: last.cursorTs, id: last.id }) : null

  const unreadCount = await countUnread(db, viewerId)
  return { notifications, unreadCount, nextCursor }
}

/**
 * Marca notificações como lidas e devolve o contador de não-lidas recontado. Anti-IDOR
 * (`recipient_id = viewerId` sempre) e idempotente (`read_at IS NULL` no WHERE).
 *
 * Semântica do `ids` (a distinção é deliberada e travada por teste):
 *  - AUSENTE (marca-tudo ao abrir a caixa) → marca TODAS as não-lidas do viewer.
 *  - PRESENTE → filtra pros ids UUID-VÁLIDOS (cada um contra `CURSOR_UUID_RE` ANTES de bindar `::uuid`,
 *    senão um id cru forjado dá 500). Se o filtrado ficar VAZIO → NO-OP (NUNCA cai em marca-tudo).
 */
export async function markRead(
  db: Database,
  viewerId: string,
  opts: { ids?: string[] } = {},
): Promise<{ unreadCount: number }> {
  const idsPresent = opts.ids !== undefined
  if (idsPresent) {
    const validIds = (opts.ids ?? []).filter((id) => CURSOR_UUID_RE.test(id))
    if (validIds.length === 0) {
      // `ids` presente mas nada válido: NO-OP (não toca linhas — nunca vira marca-tudo).
      return { unreadCount: await countUnread(db, viewerId) }
    }
    await db
      .update(notification)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notification.recipientId, viewerId),
          inArray(notification.id, validIds),
          isNull(notification.readAt),
        ),
      )
  } else {
    // Marca-tudo (ao abrir a caixa): todas as não-lidas do viewer.
    await db
      .update(notification)
      .set({ readAt: new Date() })
      .where(and(eq(notification.recipientId, viewerId), isNull(notification.readAt)))
  }
  return { unreadCount: await countUnread(db, viewerId) }
}
