/**
 * Sorteio da frase da faixa da home para visitantes (#472). PURO: `random` entra por parâmetro (padrão
 * `Math.random`). Quem chama é a home (server), uma vez por requisição; o índice desce como prop para a faixa
 * (client), então servidor e navegador pintam a mesma frase.
 */

/** Índice sorteado em [0, total). Fora da faixa (um `random` que devolva 1 ou negativo) cai na ponta mais perto. */
export function sortearFaixa(total: number, random: () => number = Math.random): number {
  return Math.min(total - 1, Math.max(0, Math.floor(random() * total)))
}
