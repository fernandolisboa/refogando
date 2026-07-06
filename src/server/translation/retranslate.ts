import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Database } from '@/db/client'
import { recipe, recipeTranslation, recipeIngredient } from '@/db/schema'
import { getTranslator } from '@/server/deps'
import { embedTranslation } from '@/server/embedding/recompute'
import { loadRecipeTranslationContext } from '@/server/recipe/load'
import { TRANSLATION_PROMPT_VERSION } from '@/domain/translation-prompt'
import { sourceFingerprintOf, mtFingerprintOfRow } from '@/domain/translation-fingerprint'
import { isDefasada, isDivergente } from '@/domain/translation-divergent-stale'

/**
 * Re-tradução automática de defasadas (issue #499, fatia B do ADR-0031 dec.5) — espelha
 * `recomputeMissingEmbeddings` (`src/server/embedding/recompute.ts`): efeito de ADMIN, capado +
 * RETOMÁVEL, que varre as traduções DERIVADAS (locale ≠ `recipe.original_locale`) e re-traduz um
 * lote das que estão **defasadas E intocadas**:
 *
 *  - defasada  = `sourceFingerprintOf(fonte atual) ≠ source_fingerprint` (o original mudou) OU
 *    `prompt_version < TRANSLATION_PROMPT_VERSION` (o tradutor melhorou; NULL conta como 0 —
 *    linha legada sem versão).
 *  - intocada  = `mtFingerprintOfRow(linha atual) == mt_fingerprint`. `mt_fingerprint` NULL ⇒
 *    NUNCA intocada (protege legado/trabalho humano, ADR-0031 dec.2).
 *
 * O comparador de hash roda TODO no app (decisão 4): carrega as linhas derivadas + a tradução de
 * origem + os ingredientes correntes de cada Receita numa passada, e computa defasada/intocada em
 * memória — barato no tamanho do acervo (centenas de linhas). Só as REALMENTE defasadas-e-
 * intocadas (até `limit`) pagam o custo de LLM (`getTranslator().translate`).
 *
 * Degradação é POR LINHA (não por lote, ao contrário do embedding-backfill que para no 1º erro):
 * se o tradutor LANÇA numa Receita, a linha é pulada (fica defasada, zero escrita, conta como
 * `degraded`) e o lote CONTINUA até processar `limit` candidatas. Cada escrita bem-sucedida reusa
 * o write-path de `ensureTranslation` (regenera título/corpo + nomes), mantém
 * `provenance='automatica_nao_revisada'`, PRESERVA o slug congelado (nunca toca `slug`), re-embeda
 * (`embedTranslation`, best-effort) e reescreve os dois fingerprints + `prompt_version` atuais (a
 * linha volta a ser intocada e não-defasada).
 */

export type RetranslateResult = {
  retranslated: number
  degraded: number
  remaining: number
}

/** Linha candidata (derivada) + o que precisamos pra decidir defasada/intocada. */
type CandidateRow = {
  recipeId: string
  locale: string
  titulo: string
  descricao: string | null
  passos: string[] | null
  notas: string | null
  ingredientes: { ordem: number; nome: string; nomeOrigem: string }[] | null
  sourceFingerprint: string | null
  mtFingerprint: string | null
  promptVersion: number | null
  srcTitulo: string
  srcDescricao: string | null
  srcPassos: string[] | null
  srcNotas: string | null
}

/**
 * Carrega TODAS as linhas de tradução DERIVADAS (locale ≠ original_locale da Receita) junto com os
 * campos da tradução de ORIGEM (self-join por `recipe_id` + `original_locale`) — uma passada só,
 * sem N+1 por candidata. Os ingredientes de origem (raw_text por `ordem`) vêm de uma 2ª query
 * agrupada em memória (mesmo filtro de `loadRecipeTranslationContext`: raw_text não-nulo/não-vazio).
 */
async function loadCandidates(db: Database): Promise<CandidateRow[]> {
  const src = alias(recipeTranslation, 'src')

  const rows = await db
    .select({
      recipeId: recipeTranslation.recipeId,
      locale: recipeTranslation.locale,
      titulo: recipeTranslation.titulo,
      descricao: recipeTranslation.descricao,
      passos: recipeTranslation.passos,
      notas: recipeTranslation.notas,
      ingredientes: recipeTranslation.ingredientes,
      sourceFingerprint: recipeTranslation.sourceFingerprint,
      mtFingerprint: recipeTranslation.mtFingerprint,
      promptVersion: recipeTranslation.promptVersion,
      srcTitulo: src.titulo,
      srcDescricao: src.descricao,
      srcPassos: src.passos,
      srcNotas: src.notas,
    })
    .from(recipeTranslation)
    .innerJoin(recipe, eq(recipe.id, recipeTranslation.recipeId))
    .innerJoin(
      src,
      and(eq(src.recipeId, recipeTranslation.recipeId), eq(src.locale, recipe.originalLocale)),
    )
    .where(
      and(
        sql`${recipeTranslation.locale} <> ${recipe.originalLocale}`,
        // #18: NÃO reprocessa Receita removida do pool pela moderação (mesma cláusula da lista do
        // Curador e do caminho on-demand) — não reenvia conteúdo moderado ao tradutor externo nem o
        // regrava. Receita PRIVADA de usuário PERMANECE no escopo de propósito: é conteúdo do próprio
        // dono (já traduzido on-demand na visualização dele), e mantê-lo fresco é o comportamento certo.
        isNull(recipe.moderationRemovedAt),
      ),
    )

  return rows
}

/** Ingredientes de ORIGEM atuais por Receita: `ordem`+`rawText`, mesmo filtro de load.ts. */
async function loadCurrentIngredientsByRecipe(
  db: Database,
  recipeIds: string[],
): Promise<Map<string, { ordem: number; nome: string }[]>> {
  const byRecipe = new Map<string, { ordem: number; nome: string }[]>()
  if (recipeIds.length === 0) return byRecipe

  const ingRows = await db
    .select({
      recipeId: recipeIngredient.recipeId,
      ordem: recipeIngredient.ordem,
      rawText: recipeIngredient.rawText,
    })
    .from(recipeIngredient)
    .where(inArray(recipeIngredient.recipeId, recipeIds))
    .orderBy(recipeIngredient.ordem, recipeIngredient.id)

  for (const r of ingRows) {
    if (r.rawText == null || r.rawText.trim() === '') continue
    const list = byRecipe.get(r.recipeId) ?? []
    list.push({ ordem: r.ordem, nome: r.rawText })
    byRecipe.set(r.recipeId, list)
  }
  return byRecipe
}

/**
 * Identidade de uma candidata elegível (defasada E intocada) + o `mt_fingerprint` gravado no
 * momento do scan. Esse fingerprint é carregado para a RE-VERIFICAÇÃO de intocabilidade dentro de
 * `retranslateOne` (fecha o TOCTOU entre o scan e a escrita): uma edição humana concorrente muda o
 * conteúdo da linha mas NÃO o `mt_fingerprint` gravado, então recomputar o hash do conteúdo fresco
 * e compará-lo com este valor detecta a edição antes de sobrescrevê-la.
 */
type Eligible = { recipeId: string; locale: string; mtFingerprint: string }

/**
 * Resultado do processamento de UMA candidata:
 *  - `retranslated`: re-traduzida e persistida.
 *  - `degraded`: o tradutor LANÇOU (transitório, ex. 429) — permanece defasada-e-intocada, volta a
 *    ser candidata na próxima chamada (conta em `remaining`).
 *  - `skipped`: deixou de ser elegível entre o scan e agora (edição humana concorrente ⇒ não-intocada,
 *    ou a linha/fonte sumiu). Saiu para a fila do Curador (ADR-0031 dec.6) — NÃO volta ao worker,
 *    então é EXCLUÍDA de `remaining`.
 */
type OneResult = 'retranslated' | 'degraded' | 'skipped'

/**
 * Filtra as candidatas defasadas-e-intocadas, comparando o hash ATUAL (recomputado com os mesmos
 * helpers da escrita) contra o fingerprint gravado. Puro dado o snapshot carregado — sem I/O.
 */
function selectEligible(
  rows: CandidateRow[],
  ingredientsByRecipe: Map<string, { ordem: number; nome: string }[]>,
): Eligible[] {
  const eligible: Eligible[] = []

  for (const row of rows) {
    const currentIngredientes = ingredientsByRecipe.get(row.recipeId) ?? []
    const currentSourceFingerprint = sourceFingerprintOf(
      { titulo: row.srcTitulo, descricao: row.srcDescricao, passos: row.srcPassos, notas: row.srcNotas },
      currentIngredientes,
    )
    // MESMA regra pura da lista do Curador (fonte única, ADR-0031 dec.5/6): o worker é elegível
    // quando defasada E INTOCADA (i.e. NÃO divergente) — o complemento exato da fila do #500.
    const defasada = isDefasada({
      currentSourceFingerprint,
      storedSourceFingerprint: row.sourceFingerprint,
      storedPromptVersion: row.promptVersion,
      translationPromptVersion: TRANSLATION_PROMPT_VERSION,
    })
    if (!defasada) continue

    const currentMtFingerprint = mtFingerprintOfRow({
      titulo: row.titulo,
      descricao: row.descricao,
      passos: row.passos,
      notas: row.notas,
      ingredientes: row.ingredientes,
    })
    // `mt_fingerprint` NULL ⇒ divergente ⇒ NUNCA intocada (protege legado/trabalho humano, dec.2).
    const intocada = !isDivergente({ currentMtFingerprint, storedMtFingerprint: row.mtFingerprint })
    if (!intocada) continue

    // `mtFingerprint` é não-nulo aqui (senão `isDivergente` seria true) — narrow para o tipo Eligible.
    eligible.push({ recipeId: row.recipeId, locale: row.locale, mtFingerprint: row.mtFingerprint! })
  }

  return eligible
}

/**
 * Re-traduz UMA linha `(recipeId, locale)`: reusa o write-path de `ensureTranslation` (mesma
 * chamada ao Translator, mesma montagem do jsonb de ingredientes por-locale). LANÇA no translator ⇒
 * `degraded` (zero escrita, lote continua). NUNCA toca `slug`/`provenance`/`stale`.
 *
 * TOCTOU: entre o scan (`selectEligible`) e esta escrita, um Curador pode editar a linha derivada —
 * ex. o nome de ingrediente pela rota do companheiro (iii), que muda o `ingredientes jsonb` mas NÃO
 * o `mt_fingerprint` gravado. RE-VERIFICAMOS a intocabilidade aqui, com o `ctx` recém-carregado
 * (zero query extra): recomputamos o hash do conteúdo ATUAL da linha-alvo e comparamos com o
 * `mt_fingerprint` do scan (`candidate.mtFingerprint`); se divergir, a linha foi editada ⇒ `skipped`
 * (não-intocada, vai pra fila do Curador) — nunca sobrescrevemos trabalho humano.
 */
async function retranslateOne(db: Database, candidate: Eligible): Promise<OneResult> {
  const ctx = await loadRecipeTranslationContext(db, candidate.recipeId)
  if (!ctx) return 'skipped' // Receita sumiu entre o scan e o processamento: pula, sem escrita.

  const source = ctx.translations.find((t) => t.locale === ctx.originalLocale)
  if (!source) return 'skipped'

  // RE-CHECK de intocabilidade (fecha o TOCTOU): a linha-alvo AINDA precisa bater o mt_fingerprint
  // do scan. Uma edição humana concorrente muda o conteúdo (mas não o fingerprint gravado) ⇒ o hash
  // recomputado diverge ⇒ pula (deixa pro Curador). Reusa `ctx.translations` (já carregado).
  const targetRow = ctx.translations.find((t) => t.locale === candidate.locale)
  if (!targetRow) return 'skipped' // a linha derivada sumiu entre o scan e agora.
  const currentTargetMtFp = mtFingerprintOfRow({
    titulo: targetRow.titulo,
    descricao: targetRow.descricao,
    passos: targetRow.passos,
    notas: targetRow.notas,
    ingredientes: targetRow.ingredientes ?? null,
  })
  if (currentTargetMtFp !== candidate.mtFingerprint) return 'skipped' // editada desde o scan.

  let translated
  try {
    translated = await getTranslator().translate({
      sourceLocale: ctx.originalLocale,
      targetLocale: candidate.locale,
      fields: {
        titulo: source.titulo,
        descricao: source.descricao,
        passos: source.passos,
        notas: source.notas,
      },
      ingredientes: ctx.ingredients,
      contexto: { cozinha: ctx.cozinha },
    })
  } catch {
    return 'degraded' // Degradação por linha (ADR-0031 §invariantes): fica defasada, lote continua.
  }

  const nomeTraduzidoPorOrdem = new Map(
    (translated.ingredientes ?? []).map((i) => [i.ordem, i.nome] as const),
  )
  const ingredientesJsonb =
    ctx.ingredients.length > 0
      ? ctx.ingredients.map((s) => ({
          ordem: s.ordem,
          nome: nomeTraduzidoPorOrdem.get(s.ordem) ?? s.nome,
          nomeOrigem: s.nome,
        }))
      : null

  const sourceFingerprint = sourceFingerprintOf(
    { titulo: source.titulo, descricao: source.descricao, passos: source.passos, notas: source.notas },
    ctx.ingredients,
  )
  const mtFingerprint = mtFingerprintOfRow({
    titulo: translated.titulo,
    descricao: translated.descricao ?? null,
    passos: translated.passos ?? null,
    notas: translated.notas ?? null,
    ingredientes: ingredientesJsonb,
  })

  // COMMIT SOB LOCK — fecha o TOCTOU de verdade. O re-check acima roda ANTES da chamada ao tradutor,
  // que leva segundos; um Curador pode editar a linha NESSE meio-tempo (rota #498 muda o `ingredientes
  // jsonb` mas NÃO o `mt_fingerprint` gravado — então um CAS pelo campo não pegaria). Abrimos uma
  // transação curta, TRAVAMOS a linha (`SELECT ... FOR UPDATE`), RE-VERIFICAMOS a intocabilidade
  // contra o conteúdo FRESCO e só então escrevemos — atômico. Se a linha foi editada durante a
  // tradução, o hash fresco diverge ⇒ NÃO escreve (`skipped`, vai pro Curador). NUNCA toca
  // slug/provenance/stale — só conteúdo traduzido + carimbos de frescor (volta a intocada e não-defasada).
  const wrote = await db.transaction(async (tx) => {
    const [fresh] = await tx
      .select({
        titulo: recipeTranslation.titulo,
        descricao: recipeTranslation.descricao,
        passos: recipeTranslation.passos,
        notas: recipeTranslation.notas,
        ingredientes: recipeTranslation.ingredientes,
        mtFingerprint: recipeTranslation.mtFingerprint,
      })
      .from(recipeTranslation)
      .where(
        and(
          eq(recipeTranslation.recipeId, candidate.recipeId),
          eq(recipeTranslation.locale, candidate.locale),
        ),
      )
      .for('update')
    if (!fresh) return false // sumiu entre o scan e o commit
    const freshMtFp = mtFingerprintOfRow({
      titulo: fresh.titulo,
      descricao: fresh.descricao,
      passos: fresh.passos,
      notas: fresh.notas,
      ingredientes: fresh.ingredientes ?? null,
    })
    // Editada durante a tradução (ou legado sem prova) ⇒ deixou de ser intocada ⇒ não sobrescreve.
    if (fresh.mtFingerprint == null || freshMtFp !== candidate.mtFingerprint) return false
    await tx
      .update(recipeTranslation)
      .set({
        titulo: translated.titulo,
        descricao: translated.descricao ?? null,
        passos: translated.passos ?? null,
        notas: translated.notas ?? null,
        ingredientes: ingredientesJsonb,
        promptVersion: TRANSLATION_PROMPT_VERSION,
        sourceFingerprint,
        mtFingerprint,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(recipeTranslation.recipeId, candidate.recipeId),
          eq(recipeTranslation.locale, candidate.locale),
        ),
      )
    return true
  })
  if (!wrote) return 'skipped' // edição humana concorrente durante a tradução — preservada.

  // Re-embed best-effort (a tradução mudou, #14): a linha já existe, então nunca {ok:false}; se o
  // embedder lança, engole (assistivo — espelha `ensureTranslation`/embedTranslation).
  try {
    await embedTranslation(db, candidate.recipeId, candidate.locale)
  } catch {
    // embedding indisponível: a re-tradução já persistiu; recompute fica pendente via retry.
  }

  return 'retranslated'
}

/**
 * BACKFILL de re-tradução (#499) — ADMIN-ONLY, capado e RETOMÁVEL. Varre as derivadas
 * defasadas-e-intocadas, processa até `limit`, e devolve o progresso — o admin chama de novo até
 * `remaining === 0`. `degraded` conta as que o tradutor recusou nesta chamada (transitório:
 * permanecem defasadas-e-intocadas, seguem em `remaining`); as `skipped` (editadas por humano entre
 * o scan e a escrita ⇒ deixaram de ser intocadas, foram pra fila do Curador) NÃO voltam ao worker,
 * então são excluídas de `remaining`. `remaining` = elegíveis do scan − re-traduzidas − puladas
 * (inclui as `degraded` desta chamada + as elegíveis que não couberam no lote).
 */
export async function retranslateOutdated(db: Database, limit: number): Promise<RetranslateResult> {
  const rows = await loadCandidates(db)
  const recipeIds = [...new Set(rows.map((r) => r.recipeId))]
  const ingredientsByRecipe = await loadCurrentIngredientsByRecipe(db, recipeIds)

  const eligible = selectEligible(rows, ingredientsByRecipe)
  const batch = eligible.slice(0, limit)

  let retranslated = 0
  let degraded = 0
  let skipped = 0
  for (const candidate of batch) {
    const result = await retranslateOne(db, candidate)
    if (result === 'retranslated') retranslated++
    else if (result === 'degraded') degraded++
    else skipped++
  }

  return { retranslated, degraded, remaining: eligible.length - retranslated - skipped }
}
