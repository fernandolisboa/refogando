import { sql, type SQL } from 'drizzle-orm'

/**
 * Escapa os curingas de LIKE/ILIKE (`%`, `_`, `\`) num literal de busca por prefixo/substring,
 * pra um termo digitado pelo usuário casar LITERALMENTE — um `%` digitado não vira "qualquer
 * coisa", um `_` não vira "um caractere qualquer". Fonte ÚNICA reusada pela borda de handle (#128),
 * pela busca de usuários (#269) e pelo picker da Receita da semana (#457). O `\` é o ESCAPE default
 * do LIKE/ILIKE no Postgres.
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&')
}

/**
 * Gêmeo SQL de `escapeLike`, para quando o termo é NORMALIZADO no banco antes de virar padrão (a lane
 * de trigrama da Busca: `lower(immutable_unaccent(termo))`). Lá o escape em JS não basta: o
 * `unaccent` mapeia `％`, `﹪`, `＿`, `＼` e `∖` (largura total/compatibilidade) para `%`, `_` e `\`
 * ASCII, que só aparecem DEPOIS da normalização e virariam curinga. Por isso o escape roda sobre a
 * expressão já normalizada, com a mesma regra (`\` primeiro, senão os `\` inseridos para `%`/`_` seriam
 * escapados de novo). Sem `%`/`_`/`\` no termo normalizado os três `replace` são a identidade: o padrão
 * fica byte a byte o de antes. Os seis literais vão como parâmetros (nada de barra invertida em literal
 * SQL, que dependeria de `standard_conforming_strings`).
 */
export function escapeLikeSql(expr: SQL): SQL {
  return sql`replace(replace(replace(${expr}, ${'\\'}, ${'\\\\'}), ${'%'}, ${'\\%'}), ${'_'}, ${'\\_'})`
}
