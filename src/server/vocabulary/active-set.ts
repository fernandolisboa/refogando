import { and, eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { vocabularyTerm } from '@/db/schema'
import { isCozinha } from '@/domain/vocabulary'

/**
 * Leitor DB-DIRETO do conjunto ATIVO de cozinhas (#316, ADR-0025 Decisão 4).
 *
 * A validação de ESCRITA NÃO passa pelo cache do leitor `loadVocabulary` (#315): lê o DB direto,
 * p/ não aceitar slug recém-desativado nem rejeitar slug recém-criado dentro da janela do TTL.
 * Por isso este leitor é deliberadamente SEM cache — uma ida ao banco por validação de escrita.
 *
 * Devolve o conjunto CRU dos slugs `active` (inclui 'americana', 15 slugs hoje). NÃO faz o
 * enum-bounding: limitar a active ∩ COZINHAS (guarda temporária de enum-storability até a virada
 * #318) é trabalho da BORDA, que conhece se o destino ainda é a coluna/cast enum `cozinha`.
 */
export async function loadActiveCozinhaSlugs(db: Database): Promise<Set<string>> {
  const rows = await db
    .select({ slug: vocabularyTerm.slug })
    .from(vocabularyTerm)
    .where(and(eq(vocabularyTerm.kind, 'cozinha'), eq(vocabularyTerm.status, 'active')))
  return new Set(rows.map((r) => r.slug))
}

/**
 * Conjunto ATIVO ∩ enum-armazenável (`active` ∩ COZINHAS) p/ as bordas de ESCRITA (#316).
 *
 * Ponte TEMPORÁRIA de enum-storability até a virada #318: `recipe.cozinha` ainda é o pgEnum
 * `cozinha` (14 valores, sem 'americana'); bindar um slug ativo-mas-não-enumerável na coluna
 * dispararia `22P02`→500. O `.filter(isCozinha)` mantém esse slug FORA do destino enum → a borda
 * o rejeita com 400 em vez de quebrar. Centraliza a ponte num ÚNICO ponto de remoção em #318
 * (em vez de repeti-la em cada borda de escrita). A borda de LEITURA da Busca é exceção
 * deliberada: ela parte do cache (`loadVocabulary`), não deste leitor DB-direto.
 */
export async function loadEnumStorableActiveCozinhas(db: Database): Promise<Set<string>> {
  return new Set([...(await loadActiveCozinhaSlugs(db))].filter(isCozinha))
}
