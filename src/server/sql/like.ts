/**
 * Escapa os curingas de LIKE/ILIKE (`%`, `_`, `\`) num literal de busca por prefixo/substring,
 * pra um termo digitado pelo usuário casar LITERALMENTE — um `%` digitado não vira "qualquer
 * coisa", um `_` não vira "um caractere qualquer". Fonte ÚNICA reusada pela borda de handle (#128)
 * e pela busca de usuários (#269). O `\` é o ESCAPE default do LIKE/ILIKE no Postgres.
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&')
}
