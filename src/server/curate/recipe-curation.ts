import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeTranslation } from '@/db/schema'
import { CURATION_QUEUE_STATUSES, type CurationStatus } from '@/domain/recipe-curation'
import { embedTranslation } from '@/server/embedding/recompute'

/**
 * Fila de CURADORIA de RECEITAS de catálogo (#238, ADR-0026) — análoga à fila proativa de imagens
 * (`review.ts`), mas é um GATE DE PRÉ-PUBLICAÇÃO (bloqueante): um rascunho de catálogo (owner-null)
 * `pending`/`editing` fica ESCONDIDO até o Curador APROVAR (vai ao público + promove o original
 * locale pra `automatica_revisada` + embeda) ou REJEITAR (tombstone, guardado, nunca público).
 *
 * Todas as ações são guardadas por `owner_id IS NULL` (catálogo) + estado válido, com FOR UPDATE
 * serializando curadorias concorrentes. owner-not-null ⇒ `not_found` (não-catálogo NÃO é curável
 * por aqui, e não vaza existência de receita de usuário). A leitura da fila é Curador-aware (mostra
 * rascunhos escondidos sem leak — só o route a gateia com `requireRole('curador')`).
 */

export type CatalogQueueItem = {
  recipeId: string
  titulo: string | null
  locale: string // o original_locale (a língua que o Curador lê pra curar)
  cozinha: string | null
  categoria: string | null
  porcoes: number | null
  dificuldade: number | null
  curationStatus: CurationStatus
  createdAt: Date
  reviewNote: string | null
}

async function listByStatus(db: Database, statuses: readonly CurationStatus[]): Promise<CatalogQueueItem[]> {
  const rows = await db
    .select({
      recipeId: recipe.id,
      titulo: recipeTranslation.titulo,
      locale: recipe.originalLocale,
      cozinha: recipe.cozinha,
      categoria: recipe.categoria,
      porcoes: recipe.porcoes,
      dificuldade: recipe.dificuldade,
      curationStatus: recipe.curationStatus,
      createdAt: recipe.createdAt,
      reviewNote: recipe.reviewNote,
    })
    .from(recipe)
    // Título no locale ORIGINAL (a língua de curadoria). LEFT JOIN: rascunho sem tradução ainda
    // aparece (título null) — não some da fila por falta de tradução.
    .leftJoin(
      recipeTranslation,
      and(eq(recipeTranslation.recipeId, recipe.id), eq(recipeTranslation.locale, recipe.originalLocale)),
    )
    .where(and(sql`${recipe.ownerId} IS NULL`, inArray(recipe.curationStatus, [...statuses])))
    .orderBy(recipe.createdAt, recipe.id)
  return rows.map((r) => ({ ...r, categoria: r.categoria ?? null }))
}

/** A fila ACTIVE: rascunhos ainda não decididos (pending + editing), mais antigos primeiro. */
export function listCatalogCurationQueue(db: Database): Promise<CatalogQueueItem[]> {
  return listByStatus(db, CURATION_QUEUE_STATUSES)
}

/** Os REJEITADOS (tombstones) — pra o dono rever/medir/des-rejeitar. */
export function listRejectedCatalog(db: Database): Promise<CatalogQueueItem[]> {
  return listByStatus(db, ['rejected'])
}

type CurationActionResult =
  | { kind: 'ok' } //            200 — transicionou
  | { kind: 'not_found' } //     404 — inexistente OU não-catálogo (não vaza)
  | { kind: 'invalid_state' } // 409 — estado incompatível com a ação

async function loadCatalogDraftForUpdate(
  tx: Database,
  recipeId: string,
): Promise<{ ownerId: string | null; curationStatus: CurationStatus; originalLocale: string } | null> {
  const [r] = await tx
    .select({
      ownerId: recipe.ownerId,
      curationStatus: recipe.curationStatus,
      originalLocale: recipe.originalLocale,
    })
    .from(recipe)
    .where(eq(recipe.id, recipeId))
    .for('update')
  return r ?? null
}

/**
 * APROVAR (pending|editing → approved): vai ao público + selo editorial. Promove SÓ a tradução do
 * `original_locale` `automatica_nao_revisada`→`automatica_revisada` (ADR-0026 dec.5 — o Curador só
 * leu o original; o 2º locale fica `automatica_nao_revisada`, ainda indexado, promovido depois na
 * fila de revisão de tradução). PÓS-tx: embeda CADA locale best-effort (não bloqueia — embedder pode
 * 429/sem-key; semântica dormente até o backfill, como em todo lugar).
 */
export async function approveCatalogRecipe(input: {
  db: Database
  recipeId: string // já validado uuid pelo route
  curatorId: string // session.user.id (route passou pelo requireRole 'curador')
}): Promise<CurationActionResult> {
  const { db, recipeId, curatorId } = input

  const result = await db.transaction(async (tx) => {
    const r = await loadCatalogDraftForUpdate(tx, recipeId)
    if (!r || r.ownerId != null) return { kind: 'not_found' as const }
    if (r.curationStatus !== 'pending' && r.curationStatus !== 'editing') {
      return { kind: 'invalid_state' as const }
    }
    await tx
      .update(recipe)
      .set({ curationStatus: 'approved', reviewedAt: sql`now()`, reviewedBy: curatorId })
      .where(eq(recipe.id, recipeId))
    // Promove SÓ o original_locale, e só se era automática-não-revisada (rascunho de IA). Hand-made
    // (escrita_por_pessoa) nasce approved e nunca passa por aqui; a guarda de provenance a protege.
    await tx
      .update(recipeTranslation)
      .set({ provenance: 'automatica_revisada' })
      .where(
        and(
          eq(recipeTranslation.recipeId, recipeId),
          eq(recipeTranslation.locale, r.originalLocale),
          eq(recipeTranslation.provenance, 'automatica_nao_revisada'),
        ),
      )
    return { kind: 'ok' as const }
  })

  if (result.kind !== 'ok') return result

  // Embeddings best-effort, FORA da tx (a aprovação já committou): ambos locales viram públicos/
  // buscáveis. embedTranslation LANÇA sem key/429 → engole (não desfaz a aprovação).
  const locales = await db
    .select({ locale: recipeTranslation.locale })
    .from(recipeTranslation)
    .where(eq(recipeTranslation.recipeId, recipeId))
  for (const { locale } of locales) {
    try {
      await embedTranslation(db, recipeId, locale)
    } catch {
      // embedder indisponível — a busca semântica fica dormente até o backfill (#119).
    }
  }
  return result
}

/**
 * REJEITAR (pending|editing → rejected): TOMBSTONE. Guardado (rastreio/medição/revisita), nunca
 * público, fora da fila ativa. `note` opcional registra o motivo (review_note).
 */
export async function rejectCatalogRecipe(input: {
  db: Database
  recipeId: string
  curatorId: string
  note?: string | null
}): Promise<CurationActionResult> {
  const { db, recipeId, curatorId, note } = input
  return db.transaction(async (tx) => {
    const r = await loadCatalogDraftForUpdate(tx, recipeId)
    if (!r || r.ownerId != null) return { kind: 'not_found' as const }
    if (r.curationStatus !== 'pending' && r.curationStatus !== 'editing') {
      return { kind: 'invalid_state' as const }
    }
    await tx
      .update(recipe)
      .set({
        curationStatus: 'rejected',
        reviewedAt: sql`now()`,
        reviewedBy: curatorId,
        reviewNote: note?.trim() ? note.trim() : null,
      })
      .where(eq(recipe.id, recipeId))
    return { kind: 'ok' as const }
  })
}

/**
 * Marcar EM EDIÇÃO (pending → editing): triagem (o Curador começou a refinar). Idempotente
 * (editing → editing = ok). Continua ESCONDIDO (não pisca público no meio).
 */
export async function startEditingCatalogRecipe(input: {
  db: Database
  recipeId: string
}): Promise<CurationActionResult> {
  const { db, recipeId } = input
  return db.transaction(async (tx) => {
    const r = await loadCatalogDraftForUpdate(tx, recipeId)
    if (!r || r.ownerId != null) return { kind: 'not_found' as const }
    if (r.curationStatus === 'editing') return { kind: 'ok' as const } // idempotente
    if (r.curationStatus !== 'pending') return { kind: 'invalid_state' as const }
    await tx.update(recipe).set({ curationStatus: 'editing' }).where(eq(recipe.id, recipeId))
    return { kind: 'ok' as const }
  })
}

/**
 * DES-REJEITAR (rejected → pending): traz um tombstone de volta pra fila ativa (o Curador mudou de
 * ideia). Limpa reviewed_at/by/note (volta ao estado de rascunho intocado).
 */
export async function unrejectCatalogRecipe(input: {
  db: Database
  recipeId: string
}): Promise<CurationActionResult> {
  const { db, recipeId } = input
  return db.transaction(async (tx) => {
    const r = await loadCatalogDraftForUpdate(tx, recipeId)
    if (!r || r.ownerId != null) return { kind: 'not_found' as const }
    if (r.curationStatus !== 'rejected') return { kind: 'invalid_state' as const }
    await tx
      .update(recipe)
      .set({ curationStatus: 'pending', reviewedAt: null, reviewedBy: null, reviewNote: null })
      .where(eq(recipe.id, recipeId))
    return { kind: 'ok' as const }
  })
}
