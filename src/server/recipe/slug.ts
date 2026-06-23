import { and, eq, isNotNull } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipeTranslation } from '@/db/schema'
import { freezeSlug } from '@/domain/recipe-slug'

/**
 * Materialização do Slug por idioma NA BORDA do write-path (#229, ADR-0020 decisão 4).
 *
 * ADR-0020: o slug é "derivado do título DAQUELE idioma na CRIAÇÃO da tradução". Esta é a
 * casca fina de I/O que materializa essa regra no instante da escrita — todas as 5 vias que
 * inserem `recipe_translation` (curate/derive/persist-generation/persist-import/ensure-
 * translation) passam por aqui, em vez de gravar `slug` NULL e esperar o backfill. O backfill
 * (`scripts/backfill-recipe-slugs.ts`) fica como REDE pós-deploy para as linhas já existentes
 * e para qualquer NULL residual; não é mais a ÚNICA via de geração.
 *
 * A REGRA pura vive em `@/domain/recipe-slug` (`freezeSlug`/`disambiguateSlug`/base+fallback);
 * aqui só o I/O: ler os slugs JÁ EM USO no locale (o `taken`) e aplicar `freezeSlug`.
 *
 * CONGELAMENTO (inegociável): cada chamada deriva do título ATUAL e só na 1ª vez (a criação)
 * — quem chama nunca passa um `existingSlug`, porque a tradução está NASCENDO. Revisões
 * futuras do título NÃO re-chamam isto (o write-path de edição forka uma derivada, com seu
 * próprio nascimento de slug; renomear in-place não toca o slug). Para en-US, o slug congela a
 * partir do título da MT INICIAL porque é ESTE insert (a 1ª MT) que o materializa — uma revisão
 * posterior da MT não regrava o slug.
 *
 * Aceita `Database` OU uma transação Drizzle (mesma forma de `.select()` em ambos), então serve
 * tanto as vias transacionais (curate/derive/persist) quanto a não-transacional (ensure).
 *
 * CORRIDA — POSTURA DEFINITIVA (#243): o `taken` é lido fora de lock, então dois inserts
 * concorrentes no mesmo locale com o mesmo título-base podem computar o MESMO slug; o índice
 * PARCIAL `UNIQUE(locale, slug)` recusa o 2º (23505). É uma janela minúscula (mesmo título, mesmo
 * locale, mesmo instante). A postura escolhida é ACEITA-FALHA-ROLLBACK (sem retry implícito aqui):
 * em TODAS as 5 vias de insert o `slug` faz parte do MESMO `insert(...).values({...slug...})`, então
 * um 23505 dá ROLLBACK do insert INTEIRO — NUNCA grava uma linha com `slug` NULL. Logo o cenário de
 * "NULL órfão de corrida" NÃO existe no write-path. O 23505 PROPAGA — hoje sem retry automático, vira
 * um 500 cru nas rotas (ensure/create não capturam 23505) — mas a falha é benigna (rollback limpo) e
 * uma nova chamada re-lê o `taken`, agora com o slug do vencedor, e a desambiguação determinística sucede.
 * Não embutimos retry porque o slug é computado AQUI mas o insert vive na tx do caller — um retry
 * teria de envolver o insert nas 5 vias, espalhando churn sem ganho (a janela é ínfima e a falha é
 * benigna: rollback limpo, nunca corrupção). O backfill idempotente continua como rede para o ACERVO
 * pré-fatia (linhas antigas com slug NULL), NÃO para o write-path — que já nasce com slug ou falha.
 */

/** Lê os slugs JÁ gravados (não-NULL) num locale — o `taken` da desambiguação. */
async function takenSlugsForLocale(
  db: Pick<Database, 'select'>,
  locale: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ slug: recipeTranslation.slug })
    .from(recipeTranslation)
    .where(and(eq(recipeTranslation.locale, locale), isNotNull(recipeTranslation.slug)))
  const taken = new Set<string>()
  for (const r of rows) if (r.slug != null) taken.add(r.slug)
  return taken
}

/**
 * Deriva e CONGELA o slug de UMA tradução nascente: lê o `taken` do locale e aplica a regra
 * pura. Use nas vias que inserem UMA única tradução por locale (curate, persist-generation,
 * persist-import). `existingSlug` é sempre ausente aqui (a tradução está nascendo).
 */
export async function slugForNewTranslation(
  db: Pick<Database, 'select'>,
  input: { locale: string; title: string },
): Promise<string> {
  const taken = await takenSlugsForLocale(db, input.locale)
  return freezeSlug({ existingSlug: null, title: input.title, taken })
}

/** Uma tradução nascente, do ponto de vista da geração de slug em lote. */
export type NewTranslationSlugInput = { locale: string; title: string }

/**
 * Deriva e CONGELA o slug de VÁRIAS traduções nascentes de UMA receita (o caso de `derive.ts`,
 * que copia/cria traduções de múltiplos locales numa só transação). Lê o `taken` UMA vez por
 * locale e desambigua TAMBÉM contra as irmãs nascentes do MESMO lote (duas novas no mesmo locale
 * não colidem entre si). Devolve os slugs NA MESMA ORDEM da entrada.
 */
export async function slugsForNewTranslations(
  db: Pick<Database, 'select'>,
  inputs: readonly NewTranslationSlugInput[],
): Promise<string[]> {
  const takenByLocale = new Map<string, Set<string>>()
  const out: string[] = []
  for (const input of inputs) {
    let taken = takenByLocale.get(input.locale)
    if (!taken) {
      taken = await takenSlugsForLocale(db, input.locale)
      takenByLocale.set(input.locale, taken)
    }
    const slug = freezeSlug({ existingSlug: null, title: input.title, taken })
    taken.add(slug) // irmã nascente do mesmo locale não reusa este slug
    out.push(slug)
  }
  return out
}
