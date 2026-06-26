import type { Database } from '@/db/client'
import { vocabularyTerm } from '@/db/schema'
import { COZINHA_SEED } from '@/domain/vocabulary-term'

/**
 * Re-semeia a dimensão `cozinha` em `vocabulary_term` (issue #314). OBRIGATÓRIO nos testes:
 * `truncateAll` (test/setup.ts) roda TRUNCATE em todo `public` num beforeEach global ANTES de
 * cada teste, apagando as linhas que a própria migração 0033 semeou — então quem precisa dos
 * termos re-semeia por aqui (mesmo padrão de `seedUser`). Copia COZINHA_SEED (fonte única) com
 * kind 'cozinha' e status 'active', igual ao INSERT da migração. Reusável pelas fatias #315+.
 *
 * Idempotente via `onConflictDoNothing` na UNIQUE(slug): chamar duas vezes mantém 15 linhas.
 */
export async function seedVocabularyCozinhas(db: Database): Promise<void> {
  await db
    .insert(vocabularyTerm)
    .values(
      COZINHA_SEED.map((t) => ({
        kind: 'cozinha' as const,
        slug: t.slug,
        status: 'active' as const,
        labelPtBr: t.labelPtBr,
        labelEnUs: t.labelEnUs,
        sort: t.sort,
      })),
    )
    .onConflictDoNothing({ target: vocabularyTerm.slug })
}
