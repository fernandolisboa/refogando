/**
 * Parse de borda do `?sort=` da Busca — módulo PURO (issue #16, ADR-0003). Espelha a
 * borda PERMISSIVA de `facet-params`/`parseMatchMode`: degrada, NUNCA 400. Qualquer
 * valor que não seja exatamente `'popularidade'` (inclusive `null`, vazio, lixo) cai em
 * `'relevancia'` — o ranking híbrido de hoje (#14, ADR-0008).
 *
 * Só a Busca da COMUNIDADE alterna Relevância↔Popularidade; o Catálogo é editorial e
 * IGNORA `sort` (ADR-0003). Essa restrição mora no SQL da busca (a chave de popularidade
 * é gateada por `section='comunidade'`), não aqui — este módulo só normaliza o token.
 */

export type SortMode = 'relevancia' | 'popularidade'

export function parseSort(raw: string | null): SortMode {
  return raw === 'popularidade' ? 'popularidade' : 'relevancia'
}
