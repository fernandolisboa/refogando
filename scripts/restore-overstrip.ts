// REPARAÇÃO de DADOS one-off (NÃO é migração de schema): conserta os DOIS resíduos que a migração-IA
// `strip-measure-from-raw-text.ts` deixou em `recipe_ingredient.raw_text` (ADR-0012/0009 Adendo
// 2026-06-30, Direção B):
//   (a) OVER-STRIP — o modelo comeu uma palavra de PORÇÃO genuína ("4 folhas de alga nori" → "alga
//       nori", perdendo "folhas"); o contrato manda MANTER a porção no nome ("folhas de alga nori").
//   (b) STILL-EMBEDS — as 7 linhas SINALIZADAS pelo guard (mantidas como vieram) + vazamentos pós-
//       migração que AINDA carregam a medida no texto ("2 dentes de alho fatiados" → "alho fatiados").
//
// Tudo DETERMINÍSTICO (SEM modelo): cruza o `raw_text` com a medida estruturada conhecida
// (`deterministicStrip`) e classifica (`detectRepair`) em over-strip | still-embeds | none. A FRAÇÃO é
// o bloqueio crítico: "1/2 xícara de óleo" + unidade=xicara reduz a "óleo" — IGUAL ao atual ⇒ 'none'
// ⇒ NÃO tocado (jamais corrompido). Um GUARD de gravação (`assertCleanName`) ESTOURA se um nome
// restaurado começar com quantidade — falha-alto, nunca grava sujo.
//
// IDEMPOTENTE via LEDGER NOVO (scripts/data/strip-measure-restore-applied.json: rowId → {originalBefore,
// overStripped, restored, kind}). NUNCA sobrescreve o ledger ANTIGO (strip-measure-applied.json) — a
// reversibilidade depende do `before` original preservado nos dois. Re-rodar pula rowIds já restaurados.
//
// Uso:
//   tsx --env-file=.env.local scripts/restore-overstrip.ts --dry-run   # OBRIGATÓRIO 1º: buckets + linha COMPOSTA, NÃO grava
//   tsx --env-file=.env.local scripts/restore-overstrip.ts --limit 50  # processa só as 50 primeiras (qualquer modo)
//   tsx --env-file=.env.local scripts/restore-overstrip.ts             # rodada REAL (escrita + ledger), só após o dry-run
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { eq } from 'drizzle-orm'
import { makeSql, makeDb } from '@/db/client'
import { recipe, recipeIngredient, recipeTranslation } from '@/db/schema'
import { formatIngredientLine } from '@/domain/ingredient-line'
import { ptBR } from '@/i18n/messages/pt-BR'
import type { IngredientView } from '@/domain/recipe-read'
import {
  detectRepair,
  beginsWithQuantityToken,
  assertCleanName,
  headLooksSingular,
  stillEmbedsMeasure,
  isNonCountableUnit,
} from './lib/measure-strip'

const CHUNK = 50 // lote de gravação (flush do ledger por lote — resume-safe). Sem modelo: compute puro.

const OLD_LEDGER_FILE = join(process.cwd(), 'scripts', 'data', 'strip-measure-applied.json')
const RESTORE_LEDGER_FILE = join(process.cwd(), 'scripts', 'data', 'strip-measure-restore-applied.json')
const NEEDS_HUMAN_FILE = join(process.cwd(), 'scripts', 'data', 'repair-needs-human.json')
const PLURAL_HANDLIST_JSON = join(process.cwd(), 'scripts', 'data', 'plural-handlist.json')
const PLURAL_HANDLIST_MD = join(process.cwd(), 'scripts', 'data', 'plural-handlist.md')

type Row = {
  id: string
  rawText: string | null
  quantidade: string | null
  unidade: string | null
  recipeId: string
  ownerId: string | null
  originalLocale: string
}
type OldLedgerEntry = { before: string; after: string; method: string; reason?: string }
type OldLedger = Record<string, OldLedgerEntry>
type RestoreEntry = {
  originalBefore: string
  overStripped: string
  restored: string
  kind: 'over-strip' | 'still-embeds'
}
type RestoreLedger = Record<string, RestoreEntry>

type Staged = {
  id: string
  before: string // ledger `before` (ou o atual, p/ vazamentos sem ledger)
  current: string // raw_text atual (o "over-stripped")
  restored: string
  kind: 'over-strip' | 'still-embeds'
  quantidade: string | null
  unidade: string | null
  owned: boolean
  title: string
}
type NeedsHuman = {
  id: string
  current: string
  proposed: string
  kind: 'over-strip' | 'still-embeds'
  reason: string
  owned: boolean
  title: string
}

function loadJson<T>(file: string): T | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null
}
function saveJson(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
}

/** Linha COMPOSTA exibida ao dono (o que ele de fato VÊ) = formatIngredientLine sobre o nome
 * restaurado + a medida estruturada AO VIVO, locale pt-BR. NÃO o `raw_text` cru — o RENDER final. */
function composedLine(restored: string, quantidade: string | null, unidade: string | null): string {
  const item: IngredientView = { ordem: 0, quantidade, unidade, rawText: restored }
  // Assinatura NOVA (Track A, em paralelo): formatIngredientLine(item, m, locale). Em runtime o arg
  // extra é inócuo; o tsc desta worktree pode reclamar até o Track A integrar (esperado).
  return formatIngredientLine(item, ptBR, 'pt-BR')
}

/** O ORIGINAL começa com uma fração (barra ou glifo)? Compõe a tripwire "suspected-fraction": uma
 * linha de unidade NÃO-CONTÁVEL com fração-líder ("1/2 xícara de óleo") reduz a 'none' (o alias é
 * tirado pelo strip determinístico); se uma dessas aparecer no balde OVER-STRIP, o preditor regrediu
 * e reintroduziria o alias no nome — deve ser 0. (Uma fração sobre porção CONTÁVEL — "½ maço de
 * coentro" — é over-strip LEGÍTIMO: "maço" não é unidade do enum; por isso a tripwire exige a unidade
 * não-contável, não só a fração.) */
function startsWithFraction(s: string): boolean {
  return /^\s*(\d+\/\d+|\d*[½⅓⅔¼¾⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚])/.test(s ?? '')
}

function parseQty(quantidade: string | null): number | null {
  if (quantidade == null || quantidade === '') return null
  const n = Number(quantidade.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const limitArg = process.argv.find((a) => a.startsWith('--limit'))
  const limit = limitArg
    ? Number(limitArg.split('=')[1] ?? process.argv[process.argv.indexOf(limitArg) + 1])
    : Infinity

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
  const oldLedger = loadJson<OldLedger>(OLD_LEDGER_FILE) ?? {}
  const restoreLedger = loadJson<RestoreLedger>(RESTORE_LEDGER_FILE) ?? {}

  try {
    // ── Lê TODAS as linhas (não só as `method:'ai'` do ledger antigo — a varredura precisa pegar as
    //    7 sinalizadas + vazamentos pós-migração). + um título p/ o relatório (sem fan-out: mapa à parte).
    const allRows: Row[] = await db
      .select({
        id: recipeIngredient.id,
        rawText: recipeIngredient.rawText,
        quantidade: recipeIngredient.quantidade,
        unidade: recipeIngredient.unidade,
        recipeId: recipeIngredient.recipeId,
        ownerId: recipe.ownerId,
        originalLocale: recipe.originalLocale,
      })
      .from(recipeIngredient)
      .innerJoin(recipe, eq(recipeIngredient.recipeId, recipe.id))
      .orderBy(recipeIngredient.id)

    const titleRows: { recipeId: string; locale: string; titulo: string }[] = await db
      .select({
        recipeId: recipeTranslation.recipeId,
        locale: recipeTranslation.locale,
        titulo: recipeTranslation.titulo,
      })
      .from(recipeTranslation)
    const titlesByRecipe = new Map<string, Map<string, string>>()
    for (const t of titleRows) {
      if (!titlesByRecipe.has(t.recipeId)) titlesByRecipe.set(t.recipeId, new Map())
      titlesByRecipe.get(t.recipeId)!.set(t.locale, t.titulo)
    }
    const titleFor = (row: Row): string => {
      const m = titlesByRecipe.get(row.recipeId)
      if (!m) return '(sem título)'
      return m.get(row.originalLocale) ?? m.values().next().value ?? '(sem título)'
    }

    // Idempotência: pula o que JÁ está no ledger de restauração (já gravado numa rodada anterior).
    const pending = allRows
      .filter((r) => !restoreLedger[r.id])
      .slice(0, limit === undefined || Number.isNaN(limit) ? undefined : limit)
    console.log(
      `Linhas: ${allRows.length}. Já restauradas (ledger novo): ${allRows.length - pending.length}. ` +
        `A avaliar: ${pending.length}. Modo: ${dryRun ? 'DRY-RUN (sem escrita)' : 'REAL (escrita + ledger)'}.`,
    )

    // ── PASS 1 — classifica + estaciona (determinístico, SEM modelo) ───────────────────────────────
    const staged = new Map<string, Staged>()
    const needsHuman: NeedsHuman[] = []
    for (const row of pending) {
      const before = oldLedger[row.id]?.before ?? null
      const current = (row.rawText ?? '').trim()
      const r = detectRepair({ ledgerBefore: before, current, unidade: row.unidade })
      if (r.kind === 'none') continue

      const owned = row.ownerId != null
      const title = titleFor(row)
      // Ambíguo / sujo ⇒ NÃO grava; vai pro humano (vazio, ou ainda começa com quantidade, ou — defesa
      // extra — still-embeds que não conseguiu limpar a medida do texto).
      const stillDirty =
        r.restored === '' ||
        beginsWithQuantityToken(r.restored) ||
        (r.kind === 'still-embeds' && stillEmbedsMeasure(r.restored, row.unidade))
      if (stillDirty) {
        needsHuman.push({
          id: row.id,
          current,
          proposed: r.restored,
          kind: r.kind,
          reason: r.restored === '' ? 'restaurado vazio' : 'restaurado ainda embute medida/quantidade',
          owned,
          title,
        })
        continue
      }
      staged.set(row.id, {
        id: row.id,
        before: before ?? current,
        current,
        restored: r.restored,
        kind: r.kind,
        quantidade: row.quantidade,
        unidade: row.unidade,
        owned,
        title,
      })
    }

    const stagedList = [...staged.values()]
    const overStrip = stagedList.filter((s) => s.kind === 'over-strip')
    const stillEmbeds = stagedList.filter((s) => s.kind === 'still-embeds')

    // Tripwire "suspected-fraction": linha de unidade NÃO-CONTÁVEL com fração-líder no balde over-strip
    // (deveria ser 0 — a fração reduz a 'none'; só uma regressão a poria aqui). Computada aqui p/ o
    // balde (d) e o resumo; o ABORT roda DEPOIS de imprimir os baldes (pra o operador ver os dados).
    const suspectedFraction = overStrip.filter(
      (s) => isNonCountableUnit(s.unidade) && startsWithFraction(s.before),
    )

    // ── DRY-RUN GATE: imprime os baldes com a LINHA COMPOSTA (o que o dono VÊ) ──────────────────────
    const printStaged = (s: Staged) => {
      const scope = s.owned ? 'DONO' : 'catálogo'
      console.log(`  • [${scope}] "${s.current}"  →  raw_text "${s.restored}"`)
      console.log(`        render: "${composedLine(s.restored, s.quantidade, s.unidade)}"   (${s.title})`)
    }

    console.log(`\n── (a) OVER-STRIP (${overStrip.length}) — palavra de porção devolvida ──`)
    for (const s of overStrip) printStaged(s)

    console.log(`\n── (b) STILL-EMBEDS (${stillEmbeds.length}) — resíduo de medida limpo (inclui as sinalizadas) ──`)
    for (const s of stillEmbeds) printStaged(s)

    console.log(`\n── (c) NEEDS-HUMAN (${needsHuman.length}) — NÃO gravadas, ver ${NEEDS_HUMAN_FILE} ──`)
    for (const h of needsHuman.slice(0, 40)) {
      console.log(`  ⚠ [${h.owned ? 'DONO' : 'catálogo'}] "${h.current}"  ✗ "${h.proposed}"  (${h.reason}) — ${h.title}`)
    }

    console.log(`\n── (d) SUSPECTED-FRACTION: ${suspectedFraction.length} (alvo: 0) ──`)

    // Lista COMPLETA das receitas DO DONO (sem rede HITL — confira TODAS).
    const ownerStaged = stagedList.filter((s) => s.owned)
    if (ownerStaged.length > 0) {
      console.log(`\nRestauros nas receitas DO DONO (${ownerStaged.length}) — confira TODAS:`)
      for (const s of ownerStaged) printStaged(s)
    }

    console.log(
      `\nResumo PASS 1: over-strip ${overStrip.length}, still-embeds ${stillEmbeds.length}, ` +
        `needs-human ${needsHuman.length}, suspected-fraction ${suspectedFraction.length}. ` +
        `${dryRun ? '(DRY-RUN — nada gravado no DB.)' : ''}`,
    )

    // ── GATE de sanidade (ABORTA antes de qualquer escrita; roda nos DOIS modos) ────────────────────
    // (1) NENHUM nome estacionado pode começar com token de quantidade (já barrado no staging — defesa).
    for (const s of stagedList) assertCleanName(s.restored)
    // (2) suspected-fraction DEVE ser 0 (ver acima): se não, o preditor regrediu e reintroduziria o alias.
    if (suspectedFraction.length > 0) {
      for (const s of suspectedFraction) {
        console.error(
          `  ✗ FRAÇÃO não-contável restaurada como over-strip: "${s.before}" (unidade ${s.unidade}) → "${s.restored}" (${s.id})`,
        )
      }
      throw new Error(
        `ABORTADO: ${suspectedFraction.length} linha(s) de fração não-contável entraram no balde ` +
          `over-strip (deveria ser 0 — a fração reduz a 'none'). O preditor detectRepair regrediu.`,
      )
    }

    // Relatórios pro humano (escritos nos DOIS modos — são SAÍDA de análise, não estado do prod).
    saveJson(NEEDS_HUMAN_FILE, needsHuman)

    // ── Gravação (só na rodada REAL) ───────────────────────────────────────────────────────────────
    if (!dryRun) {
      for (let i = 0; i < stagedList.length; i += CHUNK) {
        const chunk = stagedList.slice(i, i + CHUNK)
        for (const s of chunk) {
          await db
            .update(recipeIngredient)
            .set({ rawText: s.restored })
            .where(eq(recipeIngredient.id, s.id))
          restoreLedger[s.id] = {
            originalBefore: s.before,
            overStripped: s.current,
            restored: s.restored,
            kind: s.kind,
          }
        }
        saveJson(RESTORE_LEDGER_FILE, restoreLedger)
        process.stdout.write(`\r  gravadas ${Math.min(i + CHUNK, stagedList.length)}/${stagedList.length}…`)
      }
      process.stdout.write('\n')
    }

    // ── POST-RUN: re-varre o estado autoritativo. Alvo após a rodada real: 0 linhas embutindo medida
    //    (falsos-positivos como nomes que começam com número são aceitáveis — a lista é p/ conferência).
    const after: { rawText: string | null; unidade: string | null }[] = await db
      .select({ rawText: recipeIngredient.rawText, unidade: recipeIngredient.unidade })
      .from(recipeIngredient)
    const remaining = after.filter((r) => stillEmbedsMeasure(r.rawText, r.unidade))
    console.log(
      `\nVERIFICAÇÃO (heurística "ainda embute medida"): ${remaining.length} linha(s) ` +
        `${dryRun ? '— estado PRÉ-reparo (dry-run não grava); rode pra valer pra zerar.' : '— alvo: 0 (confira os falsos-positivos).'}`,
    )
    for (const r of remaining.slice(0, 40)) console.log(`  ? "${r.rawText}" (unidade ${r.unidade ?? 'null'})`)
    if (remaining.length > 40) console.log(`  … e mais ${remaining.length - 40}.`)

    // ── PASS 2 — lista do HUMANO p/ plurais (P3). SEM escrita no DB. Roda DEPOIS do staging do PASS 1
    //    (usa o nome JÁ restaurado). Linhas CONTÁVEIS com quantidade > 1 cujo nome começa SINGULAR:
    //    o dono pluraliza à mão (NUNCA automatizamos — plurais especiais coração/mão/-ão vivem no nome).
    const effectiveRawText = (row: Row): string =>
      staged.get(row.id)?.restored ?? (row.rawText ?? '').trim()
    const plural = allRows
      .filter((row) => {
        const qty = parseQty(row.quantidade)
        const countable = row.unidade === 'unidade' || (row.unidade == null && qty != null)
        return countable && qty != null && qty > 1 && headLooksSingular(effectiveRawText(row))
      })
      .map((row) => ({
        id: row.id,
        escopo: row.ownerId != null ? ('dono' as const) : ('catálogo' as const),
        quantidade: row.quantidade,
        rawText: effectiveRawText(row),
        title: titleFor(row),
      }))
    saveJson(PLURAL_HANDLIST_JSON, plural)
    const mdLines = [
      '# Lista pra revisão humana — PLURAIS de nome (P3)',
      '',
      'Linhas CONTÁVEIS com quantidade > 1 cujo NOME começa singular. NÃO pluralizamos automaticamente',
      '(plurais especiais — coração/mão/-ão — vivem no nome). O dono ajusta cada uma à mão na edição.',
      '',
      `Total: ${plural.length}.`,
      '',
      '| id | escopo | qtd | nome (raw_text) | título |',
      '| --- | --- | --- | --- | --- |',
      ...plural.map(
        (p) =>
          `| ${p.id} | ${p.escopo} | ${p.quantidade ?? ''} | ${p.rawText.replace(/\|/g, '\\|')} | ${p.title.replace(/\|/g, '\\|')} |`,
      ),
      '',
    ]
    writeFileSync(PLURAL_HANDLIST_MD, mdLines.join('\n'))
    console.log(
      `\nPASS 2 (plurais, P3): ${plural.length} linha(s) p/ revisão humana → ${PLURAL_HANDLIST_JSON} + .md ` +
        '(NUNCA pluralizadas automaticamente).',
    )
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error('Falha na reparação restore-overstrip:', err instanceof Error ? err.message : err)
  process.exit(1)
})
