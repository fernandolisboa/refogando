import { and, eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { vocabularyTerm } from '@/db/schema'

/**
 * Leitor DB-DIRETO do conjunto ATIVO de cozinhas (#316/#318, ADR-0025 Decisão 4).
 *
 * A validação de ESCRITA NÃO passa pelo cache do leitor `loadVocabulary` (#315): lê o DB direto,
 * p/ não aceitar slug recém-desativado nem rejeitar slug recém-criado dentro da janela do TTL.
 * Por isso este leitor é deliberadamente SEM cache — uma ida ao banco por validação de escrita.
 *
 * Devolve o conjunto CRU dos slugs `active` (inclui 'americana', 15 slugs hoje). Desde a virada
 * #318 (`recipe.cozinha`/`briefing.cozinha` viraram `text` com FK p/ `vocabulary_term.slug`) NÃO
 * há mais enum-bounding: TODO slug ativo é armazenável; o helper `loadEnumStorableActiveCozinhas`
 * (a ponte temporária) morreu junto com o pgEnum `cozinha`. As bordas de escrita usam este leitor.
 */
export async function loadActiveCozinhaSlugs(db: Database): Promise<Set<string>> {
  const rows = await db
    .select({ slug: vocabularyTerm.slug })
    .from(vocabularyTerm)
    .where(and(eq(vocabularyTerm.kind, 'cozinha'), eq(vocabularyTerm.status, 'active')))
  return new Set(rows.map((r) => r.slug))
}
