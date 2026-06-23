import { and, eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeTranslation, recipeIngredient } from '@/db/schema'
import type { Cozinha, Categoria, Restricao, Unidade } from '@/domain/vocabulary'
import type { ImageStore } from '@/server/images/image-store'
import { applyEdit } from '@/server/recipe/edit'
import { pgCode } from '@/server/recipe/visibility'
import { reapOrphanImage, deleteOrphanBlob } from '@/server/recipe/image'
import { shouldSuggestNewImage, ingredientSetChanged } from '@/domain/image-review'

/**
 * Edição IN-PLACE + APAGAR da PRÓPRIA Receita (issue #21).
 *
 * Editar a SUA receita (privada OU pública, inclusive a sua derivada) é um UPDATE da MESMA
 * linha — NUNCA forka (o fork é #17, da receita NÃO-própria). Apagar é HARD-delete (a #21 NÃO
 * tem soft-delete: recipe não tem deleted_at; história #157 'ON DELETE SET NULL' confirma o
 * delete físico).
 *
 * Decisões congeladas (#21):
 *  - ALLOWLIST de escrita em `recipe`: SÓ cozinha/categoria/restricoes/porcoes/dificuldade.
 *    NUNCA toca origin (trigger recipe_origin_immutable ⇒ P0001), owner_id (dono é imutável),
 *    nem visibility (publicar/despublicar é #13, rota própria). O SET é montado campo a campo
 *    a partir da allowlist — uma coluna fora dela nem chega ao UPDATE.
 *  - Tradução (titulo/descricao/passos/notas) via UPDATE de `recipe_translation` + `applyEdit`
 *    (regra de #3: campo traduzível ⇒ locale stale + re-embed; invariante ⇒ no-op). REUSA o
 *    helper compartilhado — nunca re-deriva quando-marcar.
 *  - Ingredientes: editCatalogRecipe NÃO tem eixo de ingrediente, então o reescrevemos do ZERO
 *    (delete-all-then-reinsert na forma do create.ts: quantidade string|null, ingredientId null,
 *    ordem por índice). A FK canônica (alérgeno) NÃO é preservada na edição in-place — o leitor
 *    reescreveu os itens; resolver Item→canônico é fluxo de catálogo, não do dono.
 *  - Bump de updated_at em qualquer eixo que muda; o recompute (Aviso/diff) é de graça no GET.
 *
 * GATE da linha de tradução (espelha editCatalogRecipe): se há QUALQUER campo traduzível, o
 * UPDATE com RETURNING vazio = linha (recipeId, locale) AUSENTE ⇒ 'translation_not_found' (route
 * mapeia 404), ANTES de qualquer outra escrita ⇒ sem estado pela metade. Patch só de invariante/
 * ingrediente NÃO precisa do gate de tradução.
 *
 * NÃO-atomicidade tolerada (espelha src/server/recipe/edit.ts e editCatalogRecipe): a composição
 * roda transações independentes (UPDATE de tradução, UPDATE de recipe, tx de ingredientes,
 * applyEdit). Uma falha PARCIAL é aceitável porque `stale` é MONOTÔNICO (marcar a mais nunca
 * corrompe) e o re-embed é RETRYABLE (recompute idempotente). O único early-return —
 * 'translation_not_found' — acontece ANTES de qualquer escrita.
 *
 * Autorização é OWNERSHIP, provada pelo ROUTE antes de chamar (catálogo/não-dono ⇒ 404 leak-safe,
 * NUNCA 403, ADR-0011). editOwnRecipe AINDA se auto-verifica (defense-in-depth, fail-closed):
 * confere a posse UMA vez no começo (assertOwnedRecipe, espelha persist.ts assertOwnedSession de
 * #15) e escopa todas as escritas por owner_id — uma chamada com viewerId errado (bug do route,
 * nunca fluxo normal) ESTOURA em vez de tocar a linha alheia.
 */

/**
 * #21 — guarda de posse fail-closed (espelha persist.ts assertOwnedSession de #15). SELECT do
 * owner_id da receita; se a linha não existir OU o dono não for `viewerId`, ESTOURA — assim nenhuma
 * escrita subsequente (tradução / recipe / ingredientes / updated_at) toca a linha de outro dono. O
 * route já prova a posse antes de chamar; isto é defense-in-depth, então o erro só dispara num bug
 * de programação (nunca em fluxo normal). NÃO é exportado (detalhe interno da edição).
 */
async function assertOwnedRecipe(
  db: Database,
  recipeId: string,
  viewerId: string,
): Promise<void> {
  const [owned] = await db
    .select({ ownerId: recipe.ownerId })
    .from(recipe)
    .where(eq(recipe.id, recipeId))
  if (!owned || owned.ownerId !== viewerId) {
    throw new Error(
      `editOwnRecipe: receita inexistente ou não-possuída pelo viewerId (defense-in-depth fail-closed)`,
    )
  }
}

export type OwnRecipePatch = {
  // Traduzíveis (presença = mudou):
  titulo?: string
  descricao?: string | null
  passos?: string[] | null
  notas?: string | null
  // Categorização/invariante em `recipe` (allowlist — presença = mudou):
  cozinha?: Cozinha | null
  categoria?: Categoria | null
  restricoes?: Restricao[]
  porcoes?: number | null
  dificuldade?: number | null
  // Ingredientes (presença = reescreve do zero):
  ingredientes?: ReadonlyArray<{
    rawText: string | null
    quantidade: string | null // numeric(10,3) ⇒ string|null, NUNCA number
    unidade: Unidade | null
  }>
}

export type EditOwnRecipeResult =
  // `imageReviewSuggested` (#131): a edição IN-PLACE mexeu num campo VISUAL (título/ingredientes/
  // cozinha) E a Receita TEM imagem ⇒ a UI sugere revisar a foto. Edição in-place mantém o mesmo
  // image_id (mesma linha) — o carry-forward é trivial aqui; só a sugestão importa.
  | { kind: 'ok'; imageReviewSuggested: boolean }
  | { kind: 'translation_not_found' }

export async function editOwnRecipe(
  db: Database,
  input: { recipeId: string; viewerId: string; locale: string; patch: OwnRecipePatch },
): Promise<EditOwnRecipeResult> {
  const { recipeId, viewerId, locale, patch } = input
  const changedFields: string[] = []
  const now = new Date()

  // Posse provada UMA vez no começo (fail-closed): com isso garantido, todas as escritas abaixo
  // (escopadas por owner_id) só tocam a linha do próprio dono. Bug do route ⇒ estoura (não corrompe).
  await assertOwnedRecipe(db, recipeId, viewerId)

  // #131: a Receita tem imagem? (insumo da sugestão de revisar a foto após uma mudança visual.)
  const [imgRow] = await db
    .select({ imageId: recipe.imageId })
    .from(recipe)
    .where(eq(recipe.id, recipeId))
  const hasImage = imgRow?.imageId != null

  // Eixo traduzível: campos presentes em `recipe_translation`.
  const translatablePatch: Record<string, unknown> = {}
  if (patch.titulo !== undefined) {
    translatablePatch.titulo = patch.titulo
    changedFields.push('titulo')
  }
  if (patch.descricao !== undefined) {
    translatablePatch.descricao = patch.descricao
    changedFields.push('descricao')
  }
  if (patch.passos !== undefined) {
    translatablePatch.passos = patch.passos
    changedFields.push('passos')
  }
  if (patch.notas !== undefined) {
    translatablePatch.notas = patch.notas
    changedFields.push('notas')
  }

  // Eixo invariante/categorização: ALLOWLIST estrita em `recipe` (NUNCA origin/owner/visibility).
  const recipePatch: Record<string, unknown> = {}
  if (patch.cozinha !== undefined) {
    recipePatch.cozinha = patch.cozinha
    changedFields.push('cozinha')
  }
  if (patch.categoria !== undefined) {
    recipePatch.categoria = patch.categoria
    changedFields.push('categoria')
  }
  if (patch.restricoes !== undefined) {
    recipePatch.restricoes = patch.restricoes
    changedFields.push('restricoes')
  }
  if (patch.porcoes !== undefined) {
    recipePatch.porcoes = patch.porcoes
    changedFields.push('porcoes')
  }
  if (patch.dificuldade !== undefined) {
    recipePatch.dificuldade = patch.dificuldade
    changedFields.push('dificuldade')
  }

  const touchesTranslatable = Object.keys(translatablePatch).length > 0
  // `recipe.updated_at` é bumpado por DOIS caminhos: o UPDATE da allowlist (eixo recipe-level) ou,
  // quando NENHUM eixo recipe-level mudou, um único UPDATE de updated_at no fim (cobre traduzível,
  // ingrediente E patch vazio). Este flag evita o double-bump.
  let recipeRowBumped = false

  // 1. UPDATE do conteúdo traduzível ANTES de tudo (o re-embed lê o texto novo) E como GATE da
  //    linha de tradução numa só ida — MAS só quando HÁ campo traduzível: RETURNING vazio = linha
  //    (recipeId, locale) AUSENTE ⇒ early-return ANTES de tocar recipe/ingredientes/applyEdit (sem
  //    escrita parcial). Patch sem campo traduzível NÃO passa por este gate (não exige a linha do
  //    locale existir). updated_at da receita é bumpado adiante, em QUALQUER eixo que muda.
  if (touchesTranslatable) {
    // CONGELAMENTO do slug (#243, ADR-0020 dec.4): o `translatablePatch` cobre SÓ titulo/descricao/
    // passos/notas — NUNCA `slug`. Editar in-place o título NÃO re-deriva a URL canônica (que só o 1º
    // insert materializa via freezeSlug). Não adicionar `slug` a este SET é a invariante.
    const updated = await db
      .update(recipeTranslation)
      .set({ ...translatablePatch, updatedAt: now })
      .where(
        and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, locale)),
      )
      .returning({ id: recipeTranslation.id })
    if (updated.length === 0) return { kind: 'translation_not_found' }
  }

  // 2. UPDATE da allowlist em `recipe` (NUNCA origin/owner/visibility). Filtra por owner_id
  //    (E5: autoriza também na escrita). Defense-in-depth: captura P0001 (origin imutável —
  //    nunca setamos origin, então NÃO deve ocorrer) e RE-LANÇA (500 honesto, não mascara bug).
  //    Já bumpa updated_at — marca `recipeRowBumped` p/ não re-bumpar no fim.
  if (Object.keys(recipePatch).length > 0) {
    try {
      await db
        .update(recipe)
        .set({ ...recipePatch, updatedAt: now })
        .where(and(eq(recipe.id, recipeId), eq(recipe.ownerId, viewerId)))
      recipeRowBumped = true
    } catch (e) {
      if (pgCode(e) === 'P0001') throw e // origin imutável (ADR-0002) — relança, não mascara
      throw e
    }
  }

  // 3. Ingredientes: delete-all-then-reinsert DO ZERO (editCatalogRecipe não tem este eixo).
  //    Presença de `ingredientes` = reescreve a lista inteira (forma do create.ts: quantidade
  //    string|null, ingredientId null, ordem por índice). Numa transação (atômico no eixo). O
  //    delete é escopado à receita do dono (defense-in-depth — a posse já foi afirmada acima).
  if (patch.ingredientes !== undefined) {
    const ingredientes = patch.ingredientes
    // #131: o CONJUNTO de ingredientes (rótulos rawText) mudou? É VISUAL ⇒ entra em changedFields
    // (sugere revisar a foto). Lido ANTES do delete; mudança só-de-quantidade (mesmo conjunto) NÃO
    // dispara — casa a semântica de derivar/regenerar. (`ingredientes` não é campo de stale/embed,
    // então adicioná-lo a changedFields é inócuo para applyEdit — só alimenta a sugestão de imagem.)
    const beforeLabels = (
      await db
        .select({ rawText: recipeIngredient.rawText })
        .from(recipeIngredient)
        .where(eq(recipeIngredient.recipeId, recipeId))
    ).map((r) => r.rawText ?? '')
    if (ingredientSetChanged(beforeLabels, ingredientes.map((i) => i.rawText ?? ''))) {
      changedFields.push('ingredientes')
    }
    await db.transaction(async (tx) => {
      await tx.delete(recipeIngredient).where(eq(recipeIngredient.recipeId, recipeId))
      if (ingredientes.length > 0) {
        await tx.insert(recipeIngredient).values(
          ingredientes.map((it, i) => ({
            recipeId,
            ingredientId: null,
            ordem: i,
            quantidade: it.quantidade, // string|null
            unidade: it.unidade,
            rawText: it.rawText,
          })),
        )
      }
    })
  }

  // 4. Bump de updated_at em QUALQUER eixo que muda (invariante do módulo). Se o UPDATE da allowlist
  //    já bumpou, NÃO re-bumpa. Caso contrário, se ALGO mudou (traduzível e/ou ingredientes — eixos
  //    que não passam pelo UPDATE de `recipe`), um único UPDATE escopado por owner_id. Patch vazio
  //    (nenhum eixo) também cai aqui ⇒ bump conservador (mantém o contrato "editei = mudou").
  if (!recipeRowBumped) {
    await db
      .update(recipe)
      .set({ updatedAt: now })
      .where(and(eq(recipe.id, recipeId), eq(recipe.ownerId, viewerId)))
  }

  // 4. Regra de #3 como fonte ÚNICA de stale/re-embed. Decisão vazia (só invariante/ingrediente)
  //    ⇒ applyStaleDecision no-op ⇒ zero stale/re-embed.
  await applyEdit(db, { recipeId, locale, changedFields })

  // #131: mudança VISUAL (título/ingredientes/cozinha) numa Receita COM imagem ⇒ sugere revisar a
  // foto. `changedFields` reflete os campos no patch; só os visuais disparam (filtro no domínio).
  const imageReviewSuggested = shouldSuggestNewImage({ hasImage, changed: changedFields })
  return { kind: 'ok', imageReviewSuggested }
}

/**
 * HARD-delete da própria Receita (#21). Um único `DELETE FROM recipe WHERE id AND owner_id`:
 *  - CASCATEIA os filhos (recipe_translation/recipe_ingredient/recipe_tag/recipe_vote/
 *    recipe_favorite/recipe_embedding/report — todos ON DELETE cascade FROM recipe).
 *  - SET-NULL nas refs FRACAS (parent_recipe_id de derivadas de TERCEIROS, creation_session.
 *    recipe_id, generation.recipe_id) ⇒ uma derivada de outro SOBREVIVE com snapshot completo,
 *    só perde o ponteiro pra base (história #157/#288).
 *
 * O WHERE inclui owner_id (autoriza na escrita — corrida + defense-in-depth). NÃO precisamos
 * apagar filhos à mão (o DB cascateia). Leak-safe: o route já provou ownership (404 não-403);
 * `deleted` cobre a corrida (some entre o gate e o DELETE) — devolve 'not_found' nesse caso.
 *
 * #146 — REF-COUNT da Imagem: a FK `recipe.image_id → recipe_image` é `ON DELETE set null` (one-way),
 * então apagar a Receita NÃO cascateia a `recipe_image` nem o blob. Sem o reap, apagar a ÚLTIMA
 * versão que aponta um `image_id` deixava a linha + o blob ÓRFÃOS (o carry-forward #131 fez várias
 * versões compartilharem uma imagem, então a deleção segura passou a importar). Captura o `image_id`
 * no `RETURNING` do DELETE e, na MESMA tx, roda `reapOrphanImage(tx, imageId, null)`: como a Receita
 * já foi apagada nesta tx, o COUNT exclui ela e conta só OUTRAS versões que ainda compartilham —
 * zero ⇒ apaga a `recipe_image` e devolve o blob pra deleção best-effort pós-commit (mesma máquina
 * de upload/troca/remoção, agora injetando o `ImageStore` no caminho de delete). >0 ⇒ mantém.
 */
export async function deleteOwnRecipe(
  db: Database,
  store: ImageStore,
  input: { recipeId: string; viewerId: string },
): Promise<'ok' | 'not_found'> {
  const outcome = await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(recipe)
      .where(and(eq(recipe.id, input.recipeId), eq(recipe.ownerId, input.viewerId)))
      .returning({ imageId: recipe.imageId })
    if (deleted.length === 0) return { kind: 'not_found' as const }
    // A Receita foi apagada NESTA tx ⇒ o COUNT do reap a exclui e conta só OUTRAS versões que ainda
    // compartilham o blob (carry-forward #131). image_id null ⇒ reap no-op (Receita sem imagem).
    const orphanBlobUrl = await reapOrphanImage(tx, deleted[0].imageId, null)
    return { kind: 'ok' as const, orphanBlobUrl }
  })
  if (outcome.kind === 'not_found') return 'not_found'
  // Blob best-effort DEPOIS do commit (não há rollback de blob); só apaga se for NOSSO (store.owns).
  await deleteOrphanBlob(store, outcome.orphanBlobUrl)
  return 'ok'
}
