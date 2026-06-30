// Migração de DADOS one-off (NÃO é migração de schema): por linha de `recipe_ingredient`, REMOVE a
// medida embutida no `raw_text` pra ele virar o NOME do ingrediente ("320 g de arroz arbóreo" →
// "arroz arbóreo"). A medida estruturada (`quantidade`/`unidade`) é a fonte ÚNICA e JÁ está correta
// (ADR-0012/0009 Adendo 2026-06-30, Direção B) — esta migração só limpa o TEXTO, cruzando-o com a
// medida conhecida (alta confiança). É tarefa de LINGUAGEM: um modelo BARATO (EXTRACTION_MODEL) tira
// a medida; um GUARD determinístico (anti-alucinação) valida a saída antes de gravar — rejeitado
// MANTÉM o original e é sinalizado pro dono. Linhas sem medida estruturada não tocam o modelo.
//
// ORDEM OBRIGATÓRIA: rodar ANTES de virar a exibição-compõe (senão "320 g — 320 g de arroz arbóreo")
// e ANTES de retomar a curadoria. O catálogo é HITL (curador revisa cada um, ADR-0026) — rede de
// segurança; as ~114 receitas do dono NÃO têm essa rede (best-effort + o dono confere os sinalizados).
//
// IDEMPOTENTE via LEDGER (scripts/data/strip-measure-applied.json: rowId → {before, after, method}).
// Re-rodar pula rowIds já no ledger (não re-chama o modelo nem re-grava). Gravado em lotes (resume-safe).
//
// Uso:
//   tsx --env-file=.env.local scripts/strip-measure-from-raw-text.ts --no-ai     # preview de ESCOPO grátis (sem modelo, sem escrita)
//   tsx --env-file=.env.local scripts/strip-measure-from-raw-text.ts --dry-run   # COM modelo, mostra before→after, NÃO grava
//   tsx --env-file=.env.local scripts/strip-measure-from-raw-text.ts --limit 50  # processa só as 50 primeiras (qualquer modo)
//   tsx --env-file=.env.local scripts/strip-measure-from-raw-text.ts             # rodada REAL (modelo + escrita + ledger)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { eq } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { makeSql, makeDb } from '@/db/client'
import { recipe, recipeIngredient } from '@/db/schema'
import {
  looksAlreadyClean,
  stillEmbedsMeasure,
  validateStrippedName,
  stripLeadingConnector,
  buildStripUserPrompt,
  STRIP_SYSTEM_PROMPT,
} from './lib/measure-strip'

// Modelo BARATO dedicado (espelha EXTRACTION_MODEL de @/server/claude/client — não o default da geração).
const MODEL = process.env.EXTRACTION_MODEL ?? 'claude-haiku-4-5-20251001'
const CHUNK = 10 // concorrência de chamadas ao modelo por lote (Haiku tolera; flush do ledger por lote).

const LEDGER_FILE = join(process.cwd(), 'scripts', 'data', 'strip-measure-applied.json')
const StripSchema = z.object({ nome: z.string() })

type Row = {
  id: string
  rawText: string | null
  quantidade: string | null
  unidade: string | null
  ownerId: string | null
}
type LedgerEntry = { before: string; after: string; method: 'ai' | 'ai-noop' | 'already-clean' | 'flagged'; reason?: string }
type Ledger = Record<string, LedgerEntry>

const client = new Anthropic() // lê ANTHROPIC_API_KEY do ambiente

/** Chama o modelo barato pra tirar a medida do nome. null em qualquer falha (a linha é re-tentada). */
async function aiStrip(row: Row): Promise<string | null> {
  try {
    const params = {
      model: MODEL,
      max_tokens: 256,
      system: STRIP_SYSTEM_PROMPT,
      messages: [{ role: 'user' as const, content: buildStripUserPrompt(row.rawText ?? '', row.quantidade, row.unidade) }],
      output_config: { format: zodOutputFormat(StripSchema) },
    }
    let message = await client.messages.parse(params)
    if (message.parsed_output === null) {
      message = await client.messages.parse(params) // reparo de UMA tentativa (espelha generateRecipe)
      if (message.parsed_output === null) return null
    }
    return message.parsed_output.nome
  } catch {
    return null
  }
}

function loadLedger(): Ledger {
  return existsSync(LEDGER_FILE) ? (JSON.parse(readFileSync(LEDGER_FILE, 'utf8')) as Ledger) : {}
}
function saveLedger(ledger: Ledger): void {
  mkdirSync(dirname(LEDGER_FILE), { recursive: true })
  writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2) + '\n')
}

type Decision =
  | { kind: 'skip-clean'; row: Row } // sem medida estruturada → não toca o modelo
  | { kind: 'would-call'; row: Row } // só --no-ai: iria ao modelo (preview de escopo)
  | { kind: 'change'; row: Row; after: string }
  | { kind: 'noop'; row: Row } // modelo confirmou que já estava limpo (sem mudança)
  | { kind: 'flagged'; row: Row; candidate: string; reason: string }
  | { kind: 'ai-failed'; row: Row }

/** Decide UMA linha: pula sem-medida; senão chama o modelo + valida com o guard. SEM efeito no DB. */
async function decide(row: Row, noAi: boolean): Promise<Decision> {
  const before = (row.rawText ?? '').trim()
  if (looksAlreadyClean(row.quantidade, row.unidade)) return { kind: 'skip-clean', row }
  if (noAi) return { kind: 'would-call', row } // preview de escopo: NÃO chama o modelo
  const raw = await aiStrip(row)
  if (raw == null) return { kind: 'ai-failed', row }
  const candidate = stripLeadingConnector(raw) // limpa resíduo "de farinha" → "farinha"
  const v = validateStrippedName(before, candidate, row.unidade)
  if (!v.ok) return { kind: 'flagged', row, candidate, reason: v.reason }
  const after = candidate.trim()
  return after !== before ? { kind: 'change', row, after } : { kind: 'noop', row }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const noAi = process.argv.includes('--no-ai')
  const limitArg = process.argv.find((a) => a.startsWith('--limit'))
  const limit = limitArg ? Number(limitArg.split('=')[1] ?? process.argv[process.argv.indexOf(limitArg) + 1]) : Infinity

  const url =
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL
  if (!url) {
    console.error('Defina DATABASE_URL (ou rode com --env-file=.env.local).')
    process.exit(1)
  }

  const sql = makeSql(url, { max: 1 })
  const db = makeDb(sql)
  const ledger = loadLedger()
  let changed = 0
  let noop = 0
  let clean = 0
  let wouldCall = 0
  const flagged: { id: string; before: string; candidate: string; reason: string; owned: boolean }[] = []
  const failed: { id: string; before: string }[] = []
  const ownerChanges: { id: string; before: string; after: string }[] = []
  const catalogSample: { before: string; after: string }[] = []

  try {
    const allRows: Row[] = await db
      .select({
        id: recipeIngredient.id,
        rawText: recipeIngredient.rawText,
        quantidade: recipeIngredient.quantidade,
        unidade: recipeIngredient.unidade,
        ownerId: recipe.ownerId,
      })
      .from(recipeIngredient)
      .innerJoin(recipe, eq(recipeIngredient.recipeId, recipe.id))
      .orderBy(recipeIngredient.id)

    const pending = allRows.filter((r) => !ledger[r.id]).slice(0, limit === undefined || Number.isNaN(limit) ? undefined : limit)
    const totalCatalog = allRows.filter((r) => r.ownerId == null).length
    const totalOwned = allRows.length - totalCatalog
    console.log(
      `Linhas: ${allRows.length} (catálogo ${totalCatalog} / do dono ${totalOwned}). ` +
        `Já no ledger: ${allRows.length - allRows.filter((r) => !ledger[r.id]).length}. A processar: ${pending.length}. ` +
        `Modo: ${noAi ? 'NO-AI (preview de escopo)' : dryRun ? 'DRY-RUN (modelo, sem escrita)' : 'REAL (modelo + escrita)'}.`,
    )

    for (let i = 0; i < pending.length; i += CHUNK) {
      const chunk = pending.slice(i, i + CHUNK)
      const decisions = await Promise.all(chunk.map((r) => decide(r, noAi)))
      for (const d of decisions) {
        const owned = d.row.ownerId != null
        if (d.kind === 'skip-clean') {
          clean++
          if (!dryRun && !noAi) ledger[d.row.id] = { before: d.row.rawText ?? '', after: d.row.rawText ?? '', method: 'already-clean' }
        } else if (d.kind === 'would-call') {
          wouldCall++
        } else if (d.kind === 'noop') {
          noop++
          if (!dryRun && !noAi) ledger[d.row.id] = { before: d.row.rawText ?? '', after: d.row.rawText ?? '', method: 'ai-noop' }
        } else if (d.kind === 'change') {
          changed++
          if (owned) ownerChanges.push({ id: d.row.id, before: d.row.rawText ?? '', after: d.after })
          else if (catalogSample.length < 40) catalogSample.push({ before: d.row.rawText ?? '', after: d.after })
          if (!dryRun) {
            await db.update(recipeIngredient).set({ rawText: d.after }).where(eq(recipeIngredient.id, d.row.id))
            ledger[d.row.id] = { before: d.row.rawText ?? '', after: d.after, method: 'ai' }
          }
        } else if (d.kind === 'flagged') {
          flagged.push({ id: d.row.id, before: d.row.rawText ?? '', candidate: d.candidate, reason: d.reason, owned })
          if (!dryRun) ledger[d.row.id] = { before: d.row.rawText ?? '', after: d.row.rawText ?? '', method: 'flagged', reason: d.reason }
        } else {
          failed.push({ id: d.row.id, before: d.row.rawText ?? '' })
          // AI-failed: NÃO ledger (re-tenta na próxima rodada).
        }
      }
      if (!dryRun) saveLedger(ledger)
      process.stdout.write(`\r  processadas ${Math.min(i + CHUNK, pending.length)}/${pending.length}…`)
    }
    process.stdout.write('\n')

    // ── Amostras pra inspeção ──────────────────────────────────────────────
    if (ownerChanges.length > 0) {
      console.log(`\nMudanças nas receitas DO DONO (${ownerChanges.length}) — SEM rede HITL, confira TODAS:`)
      for (const c of ownerChanges) console.log(`  • "${c.before}"  →  "${c.after}"`)
    }
    if (catalogSample.length > 0) {
      console.log(`\nAmostra de mudanças no CATÁLOGO (${catalogSample.length} de ${changed - ownerChanges.length}):`)
      for (const c of catalogSample) console.log(`  • "${c.before}"  →  "${c.after}"`)
    }
    if (flagged.length > 0) {
      console.log(`\nSINALIZADAS pelo guard (${flagged.length}) — MANTIDAS como estão, revisar à mão:`)
      for (const f of flagged.slice(0, 60)) console.log(`  ⚠ [${f.owned ? 'DONO' : 'catálogo'}] "${f.before}"  ✗ "${f.candidate}"  (${f.reason})`)
    }
    if (failed.length > 0) {
      console.log(`\nFALHA do modelo (${failed.length}) — NÃO ledgeradas (re-rode pra tentar de novo):`)
      for (const f of failed.slice(0, 30)) console.log(`  ! ${f.id}: "${f.before}"`)
    }

    console.log(
      noAi
        ? `\nResumo (NO-AI): ${wouldCall} iriam ao modelo, ${clean} sem-medida-puladas. (Preview de escopo — nada gravado, modelo não tocado.)`
        : `\nResumo: ${changed} alteradas, ${noop} já-limpas-confirmadas, ${clean} sem-medida-puladas, ` +
            `${flagged.length} sinalizadas, ${failed.length} falhas. ${dryRun ? '(DRY-RUN — nada gravado.)' : ''}`,
    )

    // ── Verificação: quantas linhas AINDA aparentam ter medida embutida? ──────
    // Re-lê do DB (estado autoritativo pós-escrita; em dry-run reflete o estado PRÉ-migração).
    const after: { rawText: string | null; unidade: string | null }[] = await db
      .select({ rawText: recipeIngredient.rawText, unidade: recipeIngredient.unidade })
      .from(recipeIngredient)
    const remaining = after.filter((r) => stillEmbedsMeasure(r.rawText, r.unidade))
    console.log(
      `\nVERIFICAÇÃO (heurística "ainda embute medida"): ${remaining.length} linha(s) ` +
        `${dryRun ? '— estado PRÉ-migração (dry-run não grava); rode pra valer pra zerar.' : '— alvo: 0 (falsos-positivos como nomes que começam com número são aceitáveis; confira a lista).'}`,
    )
    for (const r of remaining.slice(0, 40)) console.log(`  ? "${r.rawText}" (unidade ${r.unidade ?? 'null'})`)
    if (remaining.length > 40) console.log(`  … e mais ${remaining.length - 40}.`)
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error('Falha na migração strip-measure:', err instanceof Error ? err.message : err)
  process.exit(1)
})
