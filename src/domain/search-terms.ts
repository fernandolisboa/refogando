/**
 * Extração PURA de termos da Busca por Ingrediente (#9, §3.1/§3.2). Sem DB, sem I/O:
 * recebe a string `?q=` (já canonicalizada na borda do route) e a deriva nos `terms`
 * que alimentam o eixo de ingrediente, mais o `match` mode. Testável em unit.
 *
 * O route corta `q` a `MAX_QUERY_LEN` ANTES de chamar `parseSearchTerms` (anti-fan-out
 * no CROSS JOIN do `ingredient_raw_hit`); aqui re-aplicamos a sanitização C0 por termo
 * (defesa em profundidade — espelha o `rawQ.replace(...)` do route) e capamos a
 * `MAX_TERMS`. Um termo pode ser multi-palavra (`cebola roxa`) — só a VÍRGULA separa.
 */

/** Teto de termos por consulta. Limita o fan-out do CROSS JOIN da degradação raw_text
 * (um GET anônimo com `?q=` gigante não pode dirigir N ilimitado). Exportado para o
 * route capar o array e para os testes asserirem o cap. */
export const MAX_TERMS = 16

/** Mesma classe de bytes de controle C0 que o route neutraliza na borda (U+0000..U+001F
 * → espaço). NUL sobrevive ao trim() e o Postgres rejeita NUL em param text → 500; os
 * demais C0 são inócuos para busca. Definida UMA vez aqui e reusada por `route.ts` e por
 * `parseSearchTerms` (DRY: o sanitizador C0 vive num único lugar). */
const C0 = /[\x00-\x1f]/g

/**
 * Neutraliza bytes de controle C0 (U+0000..U+001F → espaço). Pura. Usada na borda do
 * route (sobre o `?q=` cru) E por-termo em `parseSearchTerms` (defesa em profundidade).
 * Reescrita com a classe `\x00-\x1f` VISÍVEL (não bytes literais) para o arquivo
 * permanecer text-diffável.
 */
export function stripControlChars(s: string): string {
  return s.replace(C0, ' ')
}

/**
 * Fatia `?q=` por vírgula → trim cada → sanitiza C0 → dropa vazios → DEDUP termos
 * distintos → capa a MAX_TERMS. Pura. NÃO corta a `MAX_QUERY_LEN` (o route já fez isso
 * ANTES do split). O dedup vem ANTES do cap para que termos DISTINTOS preencham o
 * orçamento (q='frango,frango' não dobra o overlap de uma Receita de frango).
 */
export function parseSearchTerms(q: string): string[] {
  return [
    ...new Set(
      q
        .split(',')
        .map((t) => stripControlChars(t).trim())
        .filter((t) => t.length > 0),
    ),
  ].slice(0, MAX_TERMS)
}

/**
 * Mode permissivo: `'all'` só quando explícito; qualquer outro valor (ausente, lixo,
 * `'any'`) → `'any'` (default). Pura.
 */
export function parseMatchMode(raw: string | null): 'any' | 'all' {
  return raw === 'all' ? 'all' : 'any'
}
