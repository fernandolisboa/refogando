import { and, eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeReview, session, users } from '@/db/schema'
import {
  canRemovePublicContent,
  closureEmailApplies,
  confirmsHandle,
  type AccountClosureReason,
} from '@/domain/account-closure'
import { buildAccountClosedEmail } from '@/server/auth/account-closed-email'
import { trustedAppOrigin } from '@/server/http/base-url'
import { deleteOrphanBlobsConcurrently } from '@/server/images/image-blobs'
import type { ImageStore } from '@/server/images/image-store'
import { eraseAccount } from '@/server/legal/account-erasure'
import type { Mailer } from '@/server/mail/mailer'
import { deleteOwnRecipeRows } from '@/server/recipe/owner-edit'

/**
 * ENCERRAMENTO de conta pela equipe (#606; ADR-0051 P1 e P3; Termos itens 2 e 8). O admin, no Console → Usuários,
 * elimina a conta de alguém com menos de 16 anos ou encerrada por violação grave ou repetida dos Termos. A rota
 * (`POST /api/admin/users/[id]/erasure`) já passou por `requireFreshRole('admin')` e pela guarda de mesma origem.
 *
 * O AVISO PRÉVIO é humano e vem antes do botão: no menor de 16, o e-mail pedindo a confirmação da idade e os 7 dias
 * (P1); na violação, o e-mail com o motivo e, salvo conteúdo ilegal, os 15 dias para baixar os dados (P3). Aqui só
 * se executa a decisão.
 *
 * Recusas (nenhum efeito): a própria conta (`own_account`, a pessoa usa "Seus dados"; espelha o `papel_proprio`
 * de `PUT /api/admin/roles`); conta de admin (`target_admin`: rebaixar antes, para um clique não tirar o acesso
 * de outro admin; relido sob lock na transação da eliminação); conta inexistente (`not_found`); já desativada ou
 * eliminada (`inactive`); remover o conteúdo público na violação (`public_content_not_allowed`); o @ digitado diferente
 * do atual (`handle_mismatch`).
 *
 * No menor de 16 o conteúdo público SEMPRE sai (Termos, item 2, e política, seção 9: "eliminamos a conta e o que ela
 * publicou"): a licença dada por quem é absolutamente incapaz é nula (Código Civil, arts. 3º e 166, I). Não há opção.
 *
 * Ordem do efeito:
 *  1. Lê o e-mail, o nome e o idioma REAIS (a eliminação os anonimiza) e confere as recusas.
 *  2. Derruba as sessões da pessoa: daqui em diante ela não publica nem avalia mais nada no meio do processo.
 *  3. Menor de 16: apaga as Receitas PÚBLICAS da pessoa pelo mesmo caminho do dono (`deleteOwnRecipeRows`: cascatas,
 *     ref-count da imagem, fotos das avaliações de terceiros), uma transação por receita, e TODAS as avaliações dela,
 *     inclusive as moderadas (o `applyReview` pula as moderadas e exige a receita no pool, por isso o DELETE direto).
 *     As privadas saem no passo 4, pelo núcleo da eliminação. Derivada de terceiro sobrevive (SET NULL no
 *     `parent_recipe_id`).
 *  4. `eraseAccount` com a decisão: anonimiza, apaga o privado e grava `account_closure` na mesma transação. No menor
 *     de 16, a transação apaga de novo as avaliações e despublica o que sobrou de público (corrida com o passo 3).
 *  5. Os blobs do passo 3 numa leva só, com concorrência limitada (`deleteOrphanBlobsConcurrently`), mesmo se o passo 4
 *     falhar (as linhas já saíram). Uma série por receita estouraria o `maxDuration` da rota numa conta grande.
 *  6. Depois do commit, na violação com `notify`: o e-mail de encerramento (best-effort; nunca derruba o
 *     encerramento). Conta com e-mail não confirmado não recebe (o endereço pode não ser da pessoa).
 *  7. Uma linha `[admin-erasure]` no log, sem id, e-mail ou nome.
 *
 * Os passos 3 e 4 não são uma transação só (cada receita tem a sua, como no apagar do dono). Se a eliminação falhar
 * depois do passo 3, a conta segue ativa, deslogada e sem o conteúdo público, e o admin repete: os passos 2 e 3 são
 * idempotentes e nada foi registrado.
 *
 * `notifiedByEmail` (a coluna e a resposta) diz se o aviso foi TENTADO: é decidido antes do commit, porque a linha nasce
 * dentro da transação e a tabela não tem UPDATE. Se o Resend aceitou, diz `emailSent` (resposta e log).
 */

export type CloseAccountInput = {
  adminId: string
  userId: string
  reason: AccountClosureReason
  /** Pedido explícito de remover o público. No menor de 16 é sempre feito (ignorado); na violação, recusado. */
  removePublicContent: boolean
  notify: boolean
  /** O @ digitado no diálogo (confirmação). */
  confirmHandle: string
}

export type CloseAccountResult =
  | { kind: 'closed'; removedPublicContent: boolean; notifiedByEmail: boolean; emailSent: boolean }
  | { kind: 'own_account' }
  | { kind: 'target_admin' }
  | { kind: 'not_found' }
  | { kind: 'inactive' }
  | { kind: 'public_content_not_allowed' }
  | { kind: 'handle_mismatch' }

export async function closeAccountByAdmin(
  db: Database,
  store: ImageStore,
  mailer: Mailer,
  input: CloseAccountInput,
): Promise<CloseAccountResult> {
  const userId = input.userId.toLowerCase()
  // No menor de 16 o conteúdo público sai sempre; pedir a remoção na violação é erro de quem chamou.
  if (input.removePublicContent && !canRemovePublicContent(input.reason)) {
    return { kind: 'public_content_not_allowed' }
  }
  // Normalizado: o Postgres aceita o uuid em maiúsculas (como em `PUT /api/admin/roles`).
  if (userId === input.adminId.toLowerCase()) return { kind: 'own_account' }

  // 1. A identidade real, antes de a eliminação apagá-la.
  const [target] = await db
    .select({
      handle: users.handle,
      email: users.email,
      name: users.name,
      locale: users.locale,
      role: users.role,
      emailVerified: users.emailVerified,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
  if (!target) return { kind: 'not_found' }
  if (target.deletedAt != null) return { kind: 'inactive' }
  if (target.role === 'admin') return { kind: 'target_admin' }
  if (!confirmsHandle(input.confirmHandle, target.handle)) return { kind: 'handle_mismatch' }

  const removePublic = canRemovePublicContent(input.reason)
  // "Tentado" só se o e-mail de conta está ligado: sem Resend configurado, a linha diria que avisamos sem ter tentado.
  const notify =
    closureEmailApplies(input.reason) && input.notify && target.emailVerified && mailer.canSendAccountEmail()

  // 2. Ninguém publica no meio do processo: a pessoa sai de todo lugar já (a eliminação apaga o resto das sessões).
  //    Se outro admin promover a pessoa enquanto os passos 2 e 3 rodam, a transação do passo 4 recusa
  //    (`target_admin`) depois de as sessões e o público já terem saído. Aceito: promover quem está sendo encerrado é
  //    erro de operação, e nada é registrado.
  await db.delete(session).where(eq(session.userId, userId))

  const blobs: (string | null)[] = []
  let erased: Awaited<ReturnType<typeof eraseAccount>>
  try {
    // 3. Conteúdo público (só no menor de 16).
    if (removePublic) await removePublicContent(db, userId, blobs)

    // 4. A eliminação, com a decisão registrada na mesma transação.
    erased = await eraseAccount(db, {
      userId,
      decision: {
        reason: input.reason,
        removedPublicContent: removePublic,
        notifiedByEmail: notify,
        decidedBy: input.adminId,
      },
    })
  } finally {
    // 5. Os blobs do passo 3 numa leva só, com concorrência limitada; também se a eliminação falhou.
    await deleteOrphanBlobsConcurrently(store, blobs)
  }
  // Corrida: a pessoa se eliminou, a linha sumiu ou a conta virou admin entre a leitura e a transação. Nada foi
  // registrado.
  if (erased.kind === 'already_erased') return { kind: 'inactive' }
  if (erased.kind === 'not_found') return { kind: 'not_found' }
  if (erased.kind === 'target_admin') return { kind: 'target_admin' }

  // 6. O aviso por e-mail, depois do commit.
  let emailSent = false
  if (notify) emailSent = await sendClosureEmail(mailer, target)

  // 7. Log sem dado pessoal.
  console.info(
    `[admin-erasure] concluída: motivo=${input.reason} conteudoPublicoRemovido=${removePublic} emailEnviado=${emailSent}`,
  )
  return { kind: 'closed', removedPublicContent: removePublic, notifiedByEmail: notify, emailSent }
}

/**
 * Apaga as Receitas públicas e todas as Avaliações da pessoa (passo 3) e junta em `blobs` os arquivos a apagar
 * (imagens das receitas, fotos das avaliações delas e de terceiros), para a leva única do passo 5. Junta a cada
 * receita: se a receita N falhar, os blobs das que já saíram (transações confirmadas) não ficam órfãos.
 */
async function removePublicContent(db: Database, userId: string, blobs: (string | null)[]): Promise<void> {
  const publicRecipes = await db
    .select({ id: recipe.id })
    .from(recipe)
    .where(and(eq(recipe.ownerId, userId), eq(recipe.visibility, 'public')))
  for (const r of publicRecipes) {
    const out = await deleteOwnRecipeRows(db, { recipeId: r.id, viewerId: userId })
    if (out.kind === 'ok') blobs.push(...out.orphanBlobUrls, ...out.reviewPhotoUrls)
  }

  // Um DELETE só, que devolve as fotos das linhas que saíram (denúncias e notificações da avaliação caem em cascata).
  const deleted = await db
    .delete(recipeReview)
    .where(eq(recipeReview.userId, userId))
    .returning({ photoUrl: recipeReview.photoUrl })
  blobs.push(...deleted.map((r) => r.photoUrl))
}

/** O e-mail de encerramento (passo 6). Nunca lança: qualquer falha vira `false` (o encerramento já valeu). */
async function sendClosureEmail(
  mailer: Mailer,
  target: { email: string; name: string; locale: string | null },
): Promise<boolean> {
  try {
    const origin = trustedAppOrigin()
    const mail = buildAccountClosedEmail({ to: target.email, name: target.name, locale: target.locale, origin })
    const { sent } = await mailer.sendAccountEmail(mail)
    return sent
  } catch (err) {
    console.warn(`[admin-erasure] e-mail de encerramento não enviado: erro=${err instanceof Error ? err.name : 'erro'}`)
    return false
  }
}
