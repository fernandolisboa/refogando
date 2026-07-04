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

/**
 * Leitor DB-DIRETO da VOZ de UMA cozinha (#422, ADR-0029 dec.3) — o nome exibível (pt-BR) + a nota
 * de voz curada OPCIONAL. Alimenta o eixo `vozCozinha` na borda de geração (`resolveVozCozinhaAxis`).
 *
 * QUALQUER status casa (diferente de `loadActiveCozinhaSlugs`, restrito a 'active'): a cozinha pode
 * ser 'suggested' — materializada da porta "Outra" (#319) — e ainda assim merece a instrução de voz
 * GENÉRICA (nome=slug quando não há rótulo). SEM cache: uma ida ao banco por geração, coerente com o
 * estilo write-side deste módulo. `nome` cai no `slug` quando o rótulo pt-BR está ausente (fonte única
 * do fallback). Slug inexistente ⇒ `null` (a borda resolve p/ o genérico com nome=slug do briefing).
 */
export async function loadCozinhaVoice(
  db: Database,
  slug: string,
): Promise<{ nome: string; voiceNote: string | null } | null> {
  const [row] = await db
    .select({ labelPtBr: vocabularyTerm.labelPtBr, voiceNote: vocabularyTerm.voiceNote })
    .from(vocabularyTerm)
    .where(and(eq(vocabularyTerm.kind, 'cozinha'), eq(vocabularyTerm.slug, slug)))
    .limit(1)
  if (!row) return null
  return { nome: row.labelPtBr ?? slug, voiceNote: row.voiceNote }
}
