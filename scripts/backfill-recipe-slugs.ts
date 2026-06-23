// Backfill do Slug por idioma das traduções existentes (#229, ADR-0020).
//
// A coluna `recipe_translation.slug` nasce NULLABLE (migração 0023, prod-safe sobre tabela
// populada). Este script preenche o slug das linhas que ainda estão NULL, derivando-o do
// `titulo` daquela tradução e desambiguando POR locale com sufixo numérico — usando a MESMA
// lógica pura da borda (`@/domain/recipe-slug`), fonte única, sem duplicar regra.
//
// PROPRIEDADES (inegociáveis):
//  - IDEMPOTENTE: só toca linhas com slug IS NULL; re-rodar não re-sluga nem muda slugs já
//    gravados (o `taken` é semeado com os slugs já existentes; `freezeSlug` preserva o que
//    existe). Seguro rodar N vezes.
//  - DETERMINÍSTICO: dentro de cada locale, processa as linhas numa ordem ESTÁVEL
//    (created_at, depois id) e atribui o MENOR sufixo livre — então a mesma base de dados
//    produz sempre os mesmos slugs/sufixos, mesmo em re-rodadas parciais.
//  - CONGELAMENTO: o slug derivado aqui é o congelado; revisões futuras do título não o mudam
//    (regra materializada em `freezeSlug`, idem ao write-path).
//
// Uso:  npm run backfill-recipe-slugs
//   (equivale a:  tsx --env-file=.env.local scripts/backfill-recipe-slugs.ts)
//
// ATENÇÃO: o .env.local aponta para o DB de PRODUÇÃO — isto MUTA produção (UPDATE de slugs
// hoje NULL). É seguro e idempotente, mas rode conscientemente. Em deploy, o passo de
// migração aplica a 0023 (coluna + índice); este backfill é o passo de DADOS que a acompanha.
import postgres from 'postgres'
import { computeSlugBackfill, type TranslationSlugRow } from '@/domain/recipe-slug'

// Prefere o endpoint DIRETO/unpooled (one-shot; sem prepared-statement do pooler), igual ao
// drizzle.config e ao grant-role.
const url =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL

if (!url) {
  console.error(
    'Defina DATABASE_URL (ou rode com `npm run backfill-recipe-slugs`, que carrega .env.local).',
  )
  process.exit(1)
}

const sql = postgres(url, { max: 1 })

try {
  // Carrega TODAS as traduções (slug presente OU NULL) numa ordem ESTÁVEL por locale: o
  // (locale, created_at, id) torna a atribuição de sufixo determinística e estável entre
  // re-rodadas. Trazer também as que já têm slug é o que semeia o `taken` (idempotência).
  const rows = await sql<TranslationSlugRow[]>`
    SELECT "id", "locale", "titulo", "slug"
    FROM "recipe_translation"
    ORDER BY "locale" ASC, "created_at" ASC, "id" ASC
  `

  // A REGRA (desambiguação por locale, preserva slugs existentes) vive no domínio puro —
  // fonte única partilhada com o write-path e o teste de integração.
  const assignments = computeSlugBackfill(rows)

  for (const a of assignments) {
    // Guard de corrida: só atualiza se o slug SEGUIR NULL — re-rodar nunca sobrescreve.
    await sql`
      UPDATE "recipe_translation"
      SET "slug" = ${a.slug}
      WHERE "id" = ${a.id} AND "slug" IS NULL
    `
  }

  const skipped = rows.length - assignments.length
  console.log(
    `OK — backfill de slug: ${assignments.length} tradução(ões) preenchida(s), ${skipped} já tinha(m) slug (puladas). Idempotente: re-rodar não muda nada.`,
  )
} catch (err) {
  console.error('Falha no backfill de slug:', err instanceof Error ? err.message : err)
  process.exit(1)
} finally {
  await sql.end()
}
