/**
 * Forma CANÔNICA da consulta que vira vetor de busca (#643, ADR-0057). PURO. É o texto mandado ao embedder e a base
 * da chave do cache (`search_query_embedding`): duas consultas com a mesma forma canônica dividem o vetor.
 *
 *  - NFKC: compatibilidade Unicode (ﬁ → fi, largura cheia → ASCII, `e` + acento combinante → `é`);
 *  - minúsculas: "Frango" e "frango" são a mesma busca (o vetor muda pouco com a caixa, e o FTS já ignora);
 *  - espaços em branco (inclusive tab, quebra e NBSP) colapsados num espaço, e as pontas aparadas;
 *  - corte em `maxLen` (a rota passa `MAX_QUERY_LEN`, o teto do resto da busca), DEPOIS de normalizar, e aparado
 *    de novo.
 *
 * Acentos ficam: "pão" e "pao" são consultas diferentes para o embedder (o FTS é que trata o unaccent).
 */
export function canonicalSearchQuery(q: string, maxLen: number): string {
  return q
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLen)
    .trim()
}

/** Tamanho mínimo (em caracteres Unicode) da forma canônica para virar vetor. */
export const MIN_EMBED_QUERY_CHARS = 3

/**
 * A forma canônica vale um vetor? Precisa de pelo menos `MIN_EMBED_QUERY_CHARS` caracteres e de ao menos uma letra
 * ou dígito. Fora disso a busca fica só textual (FTS + trigram), sem cache e sem gastar o limite: corta os prefixos
 * de 1–2 letras que a digitação dispara e consultas só de pontuação (o loader já ignora o vetor nesse caso).
 */
export function embeddableSearchQuery(canonical: string): boolean {
  return [...canonical].length >= MIN_EMBED_QUERY_CHARS && /[\p{L}\p{N}]/u.test(canonical)
}
