// Backfill do NOME de ingrediente por-locale das traduções existentes (#426, ADR-0030 dec.7b).
//
// A coluna `recipe_translation.ingredientes` nasce NULLABLE (migração 0052, prod-safe sobre tabela
// populada). O write-path (`ensureTranslation`) já preenche toda tradução NOVA no instante da
// escrita; este backfill cobre as linhas de 2º-locale que JÁ existiam antes da fatia — sobretudo o
// **catálogo semeado** (~225 receitas bilíngues cujos nomes de ingrediente ficaram em pt-BR). Sem
// ele o bug "nome em PT numa tela EN" persiste na vitrine indexável/SEO (o caminho público só LÊ o
// persistido — não dispara tradução) porque `ensureTranslation` curto-circuita em `exists`.
//
// PROPRIEDADES (inegociáveis):
//  - IDEMPOTENTE: só toca linhas com `ingredientes IS NULL` (o UPDATE reafirma no WHERE). Re-rodar
//    não re-traduz nem sobrescreve o que já foi preenchido.
//  - GRACIOSO: se o tradutor LANÇA (indisponível / infidelidade), a linha fica NULL e o display cai
//    no `raw_text` original — mesma degradação do runtime (AC4). Conta como "degradada", não falha.
//  - NÃO toca título/corpo/slug: só a coluna `ingredientes` (+ carimbo `prompt_version`). O tradutor
//    re-traduz os 4 campos (contexto p/ o nome), mas só os NOMES são persistidos.
//
// Uso:  npm run backfill-ingredient-names
//   (equivale a:  tsx --env-file=.env.local scripts/backfill-ingredient-names.ts)
//
// ATENÇÃO: o .env.local aponta para o DB de PRODUÇÃO e a tradução chama o LLM (custo real, ~1
// chamada por (receita, 2º-locale) sem nome ainda). É seguro e idempotente, mas rode
// CONSCIENTEMENTE. Precisa de ANTHROPIC_API_KEY no ambiente (a mesma da Geração). Em deploy, o
// passo de migração aplica a 0052 (colunas); este backfill é o passo de DADOS que a acompanha.
import postgres from 'postgres'
import { getTranslator } from '@/server/deps'
import { TRANSLATION_PROMPT_VERSION } from '@/domain/translation-prompt'

const url =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL

if (!url) {
  console.error('Defina DATABASE_URL (ou rode com `npm run backfill-ingredient-names`, que carrega .env.local).')
  process.exit(1)
}

type TargetRow = {
  id: string
  recipe_id: string
  locale: string
  original_locale: string
  cozinha: string | null
}
type FieldsRow = { titulo: string; descricao: string | null; passos: string[] | null; notas: string | null }
type ItemRow = { ordem: number; raw_text: string | null }

async function main() {
  const sql = postgres(url!, { max: 1 })
  const translator = getTranslator()

  let filled = 0
  let degraded = 0
  let skipped = 0

  try {
    // Alvos: linhas de tradução de um 2º-locale (≠ original) ainda SEM nomes de ingrediente.
    const targets = await sql<TargetRow[]>`
      SELECT rt."id", rt."recipe_id", rt."locale", r."original_locale", r."cozinha"
      FROM "recipe_translation" rt
      JOIN "recipe" r ON r."id" = rt."recipe_id"
      WHERE rt."locale" <> r."original_locale" AND rt."ingredientes" IS NULL
      ORDER BY rt."recipe_id" ASC, rt."locale" ASC
    `

    for (const t of targets) {
      // Fonte = campos do locale ORIGINAL (contexto p/ traduzir bem os nomes).
      const [src] = await sql<FieldsRow[]>`
        SELECT "titulo", "descricao", "passos", "notas"
        FROM "recipe_translation"
        WHERE "recipe_id" = ${t.recipe_id} AND "locale" = ${t.original_locale}
        LIMIT 1
      `
      if (!src) {
        skipped++
        continue
      }

      // Itens de ingrediente NOMEADOS (raw_text não-vazio) na mesma ordenação do loader.
      const items = await sql<ItemRow[]>`
        SELECT "ordem", "raw_text"
        FROM "recipe_ingredient"
        WHERE "recipe_id" = ${t.recipe_id}
        ORDER BY "ordem" ASC, "id" ASC
      `
      const ingredientes = items
        .filter((i): i is { ordem: number; raw_text: string } => i.raw_text != null && i.raw_text.trim() !== '')
        .map((i) => ({ ordem: i.ordem, nome: i.raw_text }))
      if (ingredientes.length === 0) {
        skipped++
        continue
      }

      let translated
      try {
        translated = await translator.translate({
          sourceLocale: t.original_locale,
          targetLocale: t.locale,
          fields: { titulo: src.titulo, descricao: src.descricao, passos: src.passos, notas: src.notas },
          ingredientes,
          contexto: { cozinha: t.cozinha },
        })
      } catch {
        // Degradação graciosa: deixa NULL, o display cai no raw_text (AC4). Não aborta o backfill.
        degraded++
        continue
      }

      const nomeByOrdem = new Map((translated.ingredientes ?? []).map((i) => [i.ordem, i.nome] as const))
      const jsonb = ingredientes.map((s) => ({
        ordem: s.ordem,
        nome: nomeByOrdem.get(s.ordem) ?? s.nome,
        nomeOrigem: s.nome,
      }))

      await sql`
        UPDATE "recipe_translation"
        SET "ingredientes" = ${sql.json(jsonb)}, "prompt_version" = ${TRANSLATION_PROMPT_VERSION}
        WHERE "id" = ${t.id} AND "ingredientes" IS NULL
      `
      filled++
    }

    console.log(
      `OK — backfill de nomes de ingrediente: ${filled} tradução(ões) preenchida(s), ${degraded} degradada(s) (tradutor indisponível → NULL, cai no raw_text), ${skipped} pulada(s) (sem fonte/ingrediente). Idempotente: re-rodar só toca as que ainda estão NULL.`,
    )
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error('Falha no backfill de nomes de ingrediente:', err instanceof Error ? err.message : err)
  process.exit(1)
})
