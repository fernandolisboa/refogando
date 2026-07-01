import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeSave, collection, collectionItem } from '@/db/schema'
import { eligibleToSaveByViewer } from '@/domain/recipe-pool'
import type { CurationStatus } from '@/domain/recipe-curation'
import { loadSocialState } from '@/server/recipe/load'

/**
 * Núcleo com efeito de Salvar (issue #16/#362, ADR-0003/0027). Espelha o estilo de
 * `visibility.ts`: discriminated union que o route mapeia para HTTP — rotas finas e DRY.
 *
 * GATE DE SALVAR (#362, ADR-0027 D2). `applyVisibilityTransition` faz gate de OWNERSHIP
 * (Catálogo → not_found) porque publicar exige ser o dono. SALVAR estende o pool público com
 * um escape-hatch de OWNERSHIP: o dono pode salvar a PRÓPRIA receita mesmo PRIVADA ("pra montar
 * o caderno" — #362 AC6), mas mantendo as demais barreiras (não-playful, não-removida-por-
 * moderação, não-web). Receita privada de OUTRO ⇒ not_found (404, não vaza existência — mesma
 * forma do GET).
 *
 * IDEMPOTÊNCIA (AC1): `INSERT ... ON CONFLICT (user_id, recipe_id) DO NOTHING` (salvar 2× =
 * UMA linha, sob a PK composta) e `DELETE` (desfazer; no-op se não existe). Vale também sob
 * concorrência (duas chamadas paralelas pela porta de produção colidem no ON CONFLICT).
 */

type Gate = {
  ownerId: string | null
  visibility: string
  resultKind: string
  moderationRemovedAt: Date | null
  origin: string // #168: gate de pool exclui web_imported (recipe-pool.ts)
  curationStatus: CurationStatus // #238: rascunho de catálogo fica fora do pool
}

export type SaveResult =
  | { kind: 'ok'; viewerSaved: boolean } // 200
  | { kind: 'not_found' } //                 404 — inexistente / não salvável pelo viewer

/**
 * Fetch CRU do gate (lê owner_id + visibility + result_kind + moderação + origin + curation),
 * SEM filtro de elegibilidade. Devolve `null` só quando a Receita inexiste. O predicado de
 * SALVAR é aplicado pelos chamadores sobre este mesmo row — o save precisa inspecionar o
 * `ownerId` que um gate já-filtrado descartaria.
 */
async function loadGate(db: Database, id: string): Promise<Gate | null> {
  const [gate] = await db
    .select({
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      resultKind: recipe.resultKind,
      // #18: a dimensão de moderação entra no gate de pool. Removida do pool pelo Curador
      // ⇒ não-votável/salvável (quem salvou deixa de ver, igual despublicar, AC3).
      moderationRemovedAt: recipe.moderationRemovedAt,
      // #168: proveniência entra no gate de pool — web_imported nunca é votável/salvável.
      origin: recipe.origin,
      // #238: rascunho de catálogo (não-aprovado) não entra no pool — não-votável/salvável.
      curationStatus: recipe.curationStatus,
    })
    .from(recipe)
    .where(eq(recipe.id, id))
  if (!gate) return null // inexistente
  return gate
}

export async function applySave(input: {
  db: Database
  id: string
  userId: string
  action: 'save' | 'unsave'
}): Promise<SaveResult> {
  const { db, id, userId, action } = input

  // Gate de SALVAR (#362, ADR-0027 D2): pool público OU a PRÓPRIA receita mesmo PRIVADA
  // (escape-hatch de ownership — "pra montar o caderno"). SEM barreira de autoria: salvar a
  // própria é PERMITIDO (save é marcador pessoal, não Popularidade). Privada de OUTRO ⇒ not_found
  // (404 leak-safe); own moderation-removed/playful/web ⇒ not_found (o escape-hatch mantém
  // essas barreiras).
  const gate = await loadGate(db, id)
  if (!gate || !eligibleToSaveByViewer(gate, userId)) return { kind: 'not_found' }

  if (action === 'save') {
    await db.insert(recipeSave).values({ userId, recipeId: id }).onConflictDoNothing()
  } else {
    // DESSALVAR = fonte da verdade (#364): apaga a save row E, na MESMA transação, os
    // `collection_item` daquele (user, recipe) — o cascade da FK NÃO cobre isto (dessalvar
    // apaga `recipe_save`, não `recipe`), então uma Receita ficaria numa Coleção sem estar
    // salva (viola collection_item ⊆ saves). O subquery escopa aos collection_id DAQUELE
    // usuário: nunca toca a coleção de outro que também salvou esta mesma Receita.
    await db.transaction(async (tx) => {
      await tx.delete(recipeSave).where(and(eq(recipeSave.userId, userId), eq(recipeSave.recipeId, id)))
      await tx.delete(collectionItem).where(
        and(
          eq(collectionItem.recipeId, id),
          inArray(
            collectionItem.collectionId,
            tx.select({ id: collection.id }).from(collection).where(eq(collection.userId, userId)),
          ),
        ),
      )
    })
  }

  return { kind: 'ok', viewerSaved: action === 'save' }
}

export type ViewerSocialState =
  | { kind: 'ok'; viewerSaved: boolean; isOwner: boolean }
  | { kind: 'not_found' } // 404 — inexistente / não salvável pelo viewer (leak-safe)

/**
 * Estado social do PRÓPRIO viewer para uma Receita — leitura SÓ-LEITURA que o caminho
 * PÚBLICO/cacheável da página de detalhe (ADR-0020) NÃO pode entregar no servidor: ele lê ANÔNIMO
 * (sem cookie) pra ficar cacheável, então `viewerSaved` sai ausente. Os controles de engajamento
 * (client) resolvem isto AQUI quando logado, hidratando o save real em vez de cair no convite
 * "Entrar para...".
 *
 * GATE DE SALVAR LEAK-SAFE (`eligibleToSaveByViewer`, #362): usa o gate de SALVAR pra que o DONO
 * vendo a PRÓPRIA receita PRIVADA hidrate o controle de Salvar (em vez de 404). Fora do pool E
 * não-própria ⇒ `not_found` (404, não vaza existência de Receita privada de OUTRO — espelha o
 * GET). NÃO escreve nada; `viewerSaved` é SEMPRE do `userId`.
 */
export async function loadViewerSocialState(input: {
  db: Database
  id: string // já validado como uuid pelo route
  userId: string // session.user.id (route já passou pelo requireSession)
}): Promise<ViewerSocialState> {
  const { db, id, userId } = input

  const gate = await loadGate(db, id)
  if (!gate || !eligibleToSaveByViewer(gate, userId)) return { kind: 'not_found' }

  // Estado PESSOAL do viewer (EXISTS por (userId, id) em recipe_save).
  const social = await loadSocialState(db, { id, viewerId: userId })
  return {
    kind: 'ok',
    viewerSaved: social.viewerSaved ?? false,
    isOwner: gate.ownerId === userId,
  }
}
