// Seed do CATÁLOGO (#238, ADR-0026) — insere as ~220 receitas geradas por IA como RASCUNHOS
// PENDENTES de curadoria (curation_status='pending', owner-null, bilíngue pt-BR+en-US, provenance
// automatica_nao_revisada). NÃO vão ao público até o dono CURAR (aprovar) cada uma em /admin/catalog.
//
// É um passo de DADOS (não migração): `tsx --env-file=.env.local scripts/seed-catalog.ts`. O
// .env.local aponta pro DB de PRODUÇÃO. Custo de IA = $0 (sem embedding/imagem no seed; embeda na
// aprovação, imagem por receita aprovada — ADR-0026). Os rascunhos são ESCONDIDOS, então mesmo um
// seed imperfeito é seguro (nada público até curar).
//
// IDEMPOTENTE via LEDGER (`scripts/data/catalog-seed-applied.json`, seedKey→recipeId): re-rodar pula
// os seedKeys já aplicados. Commitar o ledger após a rodada de prod registra o que foi semeado.
//
// Uso:
//   npm run seed-catalog              # insere os rascunhos pendentes
//   npm run seed-catalog -- --dry-run # só valida os specs (lê o conjunto ativo de cozinhas), sem inserir
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { makeSql, makeDb } from '@/db/client'
import {
  isCategoria,
  isRestricao,
  isUnidade,
  isPorcoesValidas,
  isDificuldadeValida,
  isActiveCozinha,
  TEMPO_MIN,
  type Cozinha,
  type Categoria,
  type Restricao,
  type Unidade,
} from '@/domain/vocabulary'
import { loadActiveCozinhaSlugs } from '@/server/vocabulary/active-set'
import { createCatalogRecipe } from '@/server/curate/create'

const DATA_DIR = join(process.cwd(), 'scripts', 'data')
const SEED_FILE = join(DATA_DIR, 'catalog-seed.json')
const LEDGER_FILE = join(DATA_DIR, 'catalog-seed-applied.json')

type SpecTranslation = { titulo: string; descricao: string | null; passos: string[]; notas: string | null }
type Spec = {
  seedKey: string
  cozinha: string
  categoria: string
  restricoes: string[]
  porcoes: number
  dificuldade: number
  tempoAtivoMin: number
  tempoTotalMin: number
  ingredientes: { rawText: string; quantidade: string | null; unidade: string | null }[]
  translations: { 'pt-BR': SpecTranslation; 'en-US': SpecTranslation }
}

function validateTranslation(t: SpecTranslation | undefined): string | null {
  if (!t) return 'tradução ausente'
  if (!t.titulo?.trim()) return 'titulo vazio'
  if (!t.descricao?.trim()) return 'descricao vazia'
  if (!Array.isArray(t.passos) || t.passos.length < 1) return 'passos vazio'
  return null
}

/** Valida um spec contra os enums/faixas/conjunto-ativo. Devolve null se OK, ou a 1ª violação. */
function validateSpec(s: Spec, active: ReadonlySet<string>): string | null {
  if (!s.seedKey?.trim()) return 'seedKey vazio'
  if (!isActiveCozinha(s.cozinha, active)) return `cozinha inativa/inválida: ${s.cozinha}`
  if (!isCategoria(s.categoria)) return `categoria inválida: ${s.categoria}`
  for (const r of s.restricoes ?? []) if (!isRestricao(r)) return `restricao inválida: ${r}`
  if (!isPorcoesValidas(s.porcoes)) return `porcoes fora da faixa: ${s.porcoes}`
  if (!isDificuldadeValida(s.dificuldade)) return `dificuldade fora da faixa: ${s.dificuldade}`
  const { min, max } = TEMPO_MIN
  if (!(Number.isInteger(s.tempoTotalMin) && s.tempoTotalMin >= min && s.tempoTotalMin <= max))
    return `tempoTotalMin fora da faixa: ${s.tempoTotalMin}`
  if (!(Number.isInteger(s.tempoAtivoMin) && s.tempoAtivoMin >= min && s.tempoAtivoMin <= max))
    return `tempoAtivoMin fora da faixa: ${s.tempoAtivoMin}`
  if (s.tempoAtivoMin > s.tempoTotalMin) return `tempoAtivo > tempoTotal (${s.tempoAtivoMin} > ${s.tempoTotalMin})`
  if (!Array.isArray(s.ingredientes) || s.ingredientes.length < 1) return 'sem ingredientes'
  for (const ing of s.ingredientes) {
    if (!ing.rawText?.trim()) return 'ingrediente sem rawText'
    if (ing.quantidade != null && typeof ing.quantidade !== 'string') return 'quantidade não-string'
    if (ing.unidade != null && !isUnidade(ing.unidade)) return `unidade inválida: ${ing.unidade}`
  }
  const ptErr = validateTranslation(s.translations?.['pt-BR'])
  if (ptErr) return `pt-BR: ${ptErr}`
  const enErr = validateTranslation(s.translations?.['en-US'])
  if (enErr) return `en-US: ${enErr}`
  return null
}

function toInput(s: Spec) {
  const tr = (locale: 'pt-BR' | 'en-US') => {
    const t = s.translations[locale]
    return {
      locale,
      titulo: t.titulo,
      descricao: t.descricao ?? null,
      passos: t.passos,
      notas: t.notas ?? null,
      provenance: 'automatica_nao_revisada' as const, // rascunho de IA — promovido na aprovação (dec.5)
    }
  }
  return {
    originalLocale: 'pt-BR',
    translations: [tr('pt-BR'), tr('en-US')],
    cozinha: s.cozinha as Cozinha,
    categoria: s.categoria as Categoria,
    restricoes: s.restricoes as Restricao[],
    porcoes: s.porcoes,
    dificuldade: s.dificuldade,
    tempoAtivoMin: s.tempoAtivoMin,
    tempoTotalMin: s.tempoTotalMin,
    ingredientes: s.ingredientes.map((i) => ({
      rawText: i.rawText,
      quantidade: i.quantidade,
      unidade: (i.unidade ?? null) as Unidade | null,
    })),
    curationStatus: 'pending' as const,
    reviewedBy: null,
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const url =
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL
  if (!url) {
    console.error('Defina DATABASE_URL (ou rode com `npm run seed-catalog`, que carrega .env.local).')
    process.exit(1)
  }
  if (!existsSync(SEED_FILE)) {
    console.error(`Arquivo de specs ausente: ${SEED_FILE}`)
    process.exit(1)
  }

  const specs = JSON.parse(readFileSync(SEED_FILE, 'utf8')) as Spec[]
  const ledger: Record<string, string> = existsSync(LEDGER_FILE)
    ? (JSON.parse(readFileSync(LEDGER_FILE, 'utf8')) as Record<string, string>)
    : {}

  const sql = makeSql(url, { max: 1 })
  const db = makeDb(sql)
  let inserted = 0
  let skipped = 0
  const invalid: string[] = []

  try {
    const active = await loadActiveCozinhaSlugs(db)

    // Pré-flight: valida TUDO antes de inserir nada (um seed inválido não corrompe o catálogo).
    for (const s of specs) {
      const err = validateSpec(s, active)
      if (err) invalid.push(`${s.seedKey}: ${err}`)
    }
    if (invalid.length > 0) {
      console.error(`ABORTADO — ${invalid.length} spec(s) inválido(s):`)
      invalid.slice(0, 50).forEach((e) => console.error('  ✗', e))
      process.exit(1)
    }
    console.log(`OK — ${specs.length} specs válidos (cozinha ativa, enums, faixas, tempos, bilíngue).`)

    if (dryRun) {
      const already = specs.filter((s) => ledger[s.seedKey]).length
      console.log(`[dry-run] inseriria ${specs.length - already}; ${already} já no ledger. Nada gravado.`)
      return
    }

    for (const s of specs) {
      if (ledger[s.seedKey]) {
        skipped++
        continue
      }
      const { recipeId } = await createCatalogRecipe(db, toInput(s))
      ledger[s.seedKey] = recipeId
      inserted++
      // Persiste o ledger A CADA inserção (resume-safe: queda no meio não re-insere o já feito).
      writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2) + '\n')
    }

    console.log(
      `OK — seed do catálogo: ${inserted} rascunho(s) PENDENTE(s) inserido(s), ${skipped} já no ledger (pulado(s)). ` +
        `Estão ESCONDIDOS até curar em /admin/catalog. Ledger: ${LEDGER_FILE}`,
    )
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error('Falha no seed do catálogo:', err instanceof Error ? err.message : err)
  process.exit(1)
})
