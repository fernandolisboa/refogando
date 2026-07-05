// Backfill dos fingerprints de conteúdo das traduções LEGADAS (#501, ADR-0031 dec.7 — migração
// AGRESSIVA). A fatia A (#496) fez `ensureTranslation` gravar `source_fingerprint`/`mt_fingerprint`
// em TODA tradução NOVA; este backfill cobre as linhas DERIVADAS que já existiam antes da fatia
// (o acervo semeado + qualquer tradução on-demand anterior) — sem elas, a máquina de re-tradução
// pull (fatia B/#499) trataria o acervo INTEIRO como "sem fingerprint ⇒ nunca intocada, nunca
// defasada-detectável" e nada se moveria.
//
// O QUE GRAVA (decisão 7 do ADR-0031, "migração agressiva do dono — acervo com quase nada editado
// à mão"), só em linhas DERIVADAS (locale ≠ recipe.original_locale — a linha do locale ORIGINAL não
// tem "fonte" separada de si mesma, fica `NULL` de propósito):
//  - `source_fingerprint = fingerprintSource(fonte ATUAL)` em TODAS as linhas derivadas — marco
//    seguro ("no dia da migração a fonte era X"); drift futuro passa a ser detectável.
//  - `mt_fingerprint = fingerprintMt(conteúdo ATUAL da linha)` SÓ nas `automatica_nao_revisada` —
//    heurística one-time de proveniência que torna o acervo MT existente auto-elegível à
//    re-tradução automática JÁ. As confiáveis (`automatica_revisada`/`escrita_por_pessoa`) ficam
//    com `mt_fingerprint` NULL DE PROPÓSITO (protegidas — nunca auto-sobrescritas).
//
// A CONSTRUÇÃO espelha byte-a-byte `ensureTranslation` (`src/server/recipe/translation.ts`): a
// regra de seleção + a montagem dos inputs vive em `computeTranslationFingerprintBackfill`
// (`src/domain/translation-fingerprint-backfill.ts`, PURA e testada em
// `test/domain/translation-fingerprint-backfill.test.ts`) — este script é só o wrapper de I/O.
//
// PROPRIEDADES (inegociáveis):
//  - IDEMPOTENTE: só toca linhas com o respectivo fingerprint ainda NULL; cada UPDATE reafirma a
//    condição no WHERE. Re-rodar não re-hasheia nada que já foi gravado.
//  - SEM chamada LLM — só hash (sha256) + SQL. Rápido e barato, roda sobre o acervo inteiro.
//  - Linhas SEM fonte (locale original ausente/corrompido) são puladas, contadas à parte — nunca
//    abortam o backfill.
//
// Uso:  npm run backfill-translation-fingerprints
//   (equivale a:  tsx --env-file=.env.local scripts/backfill-translation-fingerprints.ts)
//
// ATENÇÃO: o .env.local aponta para o DB de PRODUÇÃO — isto MUTA produção (grava fingerprints em
// linhas hoje NULL). É seguro e idempotente (e não chama LLM), mas rode CONSCIENTEMENTE — é a
// ação humana pós-deploy que habilita a re-tradução automática (fatia B) sobre o acervo legado.
import postgres from 'postgres'
import {
  computeTranslationFingerprintBackfill,
  type BackfillCandidateRow,
  type BackfillSourceFields,
} from '@/domain/translation-fingerprint-backfill'
import type { TranslationProvenance } from '@/domain/recipe'

// Prefere o endpoint DIRETO/unpooled (one-shot; sem prepared-statement do pooler) — mesmo padrão
// dos outros backfills (slug, nome-de-ingrediente).
const url =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL

if (!url) {
  console.error(
    'Defina DATABASE_URL (ou rode com `npm run backfill-translation-fingerprints`, que carrega .env.local).',
  )
  process.exit(1)
}

type TargetRow = {
  id: string
  recipe_id: string
  locale: string
  original_locale: string
  provenance: TranslationProvenance
  titulo: string
  descricao: string | null
  passos: string[] | null
  notas: string | null
  ingredientes: { ordem: number; nome: string; nomeOrigem: string }[] | null
  source_fingerprint: string | null
  mt_fingerprint: string | null
}
type OriginalFieldsRow = { titulo: string; descricao: string | null; passos: string[] | null; notas: string | null }
type IngredientItemRow = { ordem: number; raw_text: string | null }

// Embrulhado num `main()` async porque o pacote não declara `"type": "module"` — o tsx transpila
// este `.ts` para CJS, onde top-level await não existe.
async function main() {
  const sql = postgres(url!, { max: 1 })

  // Caches por `recipe_id`: várias linhas derivadas (uma por 2º-locale) partilham a MESMA fonte
  // (o locale original) — evita reconsultar por linha.
  const originalFieldsCache = new Map<string, OriginalFieldsRow | null>()
  const sourceIngredientsCache = new Map<string, { ordem: number; nome: string }[]>()

  let sourceFilled = 0
  let mtFilled = 0
  let skippedNoSource = 0

  try {
    // Alvos: linhas DERIVADAS (locale ≠ original) que ainda faltam AO MENOS UM dos dois
    // fingerprints elegíveis — o `source_fingerprint` (sempre elegível) ou o `mt_fingerprint`
    // (só nas `automatica_nao_revisada`). A linha do locale ORIGINAL nunca entra (sem fonte
    // própria, fica sempre NULL — não é "legado a migrar", é a fonte).
    const targets = await sql<TargetRow[]>`
      SELECT rt."id", rt."recipe_id", rt."locale", r."original_locale", rt."provenance",
             rt."titulo", rt."descricao", rt."passos", rt."notas", rt."ingredientes",
             rt."source_fingerprint", rt."mt_fingerprint"
      FROM "recipe_translation" rt
      JOIN "recipe" r ON r."id" = rt."recipe_id"
      WHERE rt."locale" <> r."original_locale"
        AND (
          rt."source_fingerprint" IS NULL
          OR (rt."provenance" = 'automatica_nao_revisada' AND rt."mt_fingerprint" IS NULL)
        )
      ORDER BY rt."recipe_id" ASC, rt."locale" ASC
    `

    for (const t of targets) {
      // Fonte = campos do locale ORIGINAL + `raw_text` dos ingredientes (mesma forma de
      // `loadRecipeTranslationContext`/`ensureTranslation`), cacheada por receita.
      let originalFields = originalFieldsCache.get(t.recipe_id)
      if (originalFields === undefined) {
        const [row] = await sql<OriginalFieldsRow[]>`
          SELECT "titulo", "descricao", "passos", "notas"
          FROM "recipe_translation"
          WHERE "recipe_id" = ${t.recipe_id} AND "locale" = ${t.original_locale}
          LIMIT 1
        `
        originalFields = row ?? null
        originalFieldsCache.set(t.recipe_id, originalFields)
      }

      let sourceIngredientes = sourceIngredientsCache.get(t.recipe_id)
      if (sourceIngredientes === undefined) {
        const items = await sql<IngredientItemRow[]>`
          SELECT "ordem", "raw_text"
          FROM "recipe_ingredient"
          WHERE "recipe_id" = ${t.recipe_id}
          ORDER BY "ordem" ASC, "id" ASC
        `
        sourceIngredientes = items
          .filter((i): i is { ordem: number; raw_text: string } => i.raw_text != null && i.raw_text.trim() !== '')
          .map((i) => ({ ordem: i.ordem, nome: i.raw_text }))
        sourceIngredientsCache.set(t.recipe_id, sourceIngredientes)
      }

      if (!originalFields) {
        // Sem fonte (locale original ausente — não deveria acontecer, mas nunca aborta o
        // backfill): pula, conta à parte. `mt_fingerprint` também não é tocado sem source.
        skippedNoSource++
        continue
      }

      const candidate: BackfillCandidateRow = {
        provenance: t.provenance,
        sourceFingerprint: t.source_fingerprint,
        mtFingerprint: t.mt_fingerprint,
        titulo: t.titulo,
        descricao: t.descricao,
        passos: t.passos,
        notas: t.notas,
        ingredientes: t.ingredientes,
      }
      const source: BackfillSourceFields = {
        titulo: originalFields.titulo,
        descricao: originalFields.descricao,
        passos: originalFields.passos,
        notas: originalFields.notas,
        ingredientes: sourceIngredientes,
      }

      const update = computeTranslationFingerprintBackfill(candidate, source)

      // UPDATE guardado por linha — o WHERE reafirma `IS NULL` (idempotência dupla: mesmo que a
      // seleção acima já filtre, o UPDATE nunca sobrescreve um fingerprint já gravado por outra
      // corrida concorrente ou pelo write-path).
      if (update.sourceFingerprint != null) {
        await sql`
          UPDATE "recipe_translation"
          SET "source_fingerprint" = ${update.sourceFingerprint}
          WHERE "id" = ${t.id} AND "source_fingerprint" IS NULL
        `
        sourceFilled++
      }
      if (update.mtFingerprint != null) {
        await sql`
          UPDATE "recipe_translation"
          SET "mt_fingerprint" = ${update.mtFingerprint}
          WHERE "id" = ${t.id} AND "mt_fingerprint" IS NULL AND "provenance" = 'automatica_nao_revisada'
        `
        mtFilled++
      }
    }

    console.log(
      `OK — backfill de fingerprints de tradução: ${sourceFilled} source_fingerprint preenchido(s), ` +
        `${mtFilled} mt_fingerprint preenchido(s) (só automatica_nao_revisada), ` +
        `${skippedNoSource} pulada(s) (sem locale original). Idempotente: re-rodar só toca o que ainda está NULL.`,
    )
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error('Falha no backfill de fingerprints de tradução:', err instanceof Error ? err.message : err)
  process.exit(1)
})
