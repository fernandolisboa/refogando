/**
 * Perfil culinário — lente PURA de intenção difusa → facetas resolvidas (#10, Fork D).
 *
 * Módulo de domínio sem DB, sem I/O, sem Drizzle, espelhando o estilo de
 * `vocabulary.ts`/`recipe.ts` (objetos `as const` + funções puras). Recebe o `?q=`
 * difuso, consome os tokens que casam um mapa estático intenção→faceta e devolve as
 * facetas RESOLVIDAS + o q-RESTANTE (tokens não-casados) que segue dirigindo o FTS de
 * título/ingrediente de #6/#9.
 *
 * `#14` (fusão semântica pgvector) troca este resolver por embeddings SEM mexer no filtro
 * nem no SQL: o contrato (`ProfileResolution`) é o ponto de extensão.
 *
 * O mapa é language-neutral (chaves pt-BR E en-US para os seeds — `asiatico`/`asian`,
 * `leve`/`light`), por exigência explícita da issue. As facetas resolvidas usam os
 * literais EXATOS dos enums do Vocabulário; numéricos como faixa `{min?,max?}`.
 */

import { type Cozinha, type Categoria, type Restricao } from '@/domain/vocabulary'

/** Faixa resolvida (caso degenerado exato => min===max). */
export type FaixaResolvida = { min?: number; max?: number }

/** Conjunto de facetas que uma intenção resolve. Só as chaves que a entrada define. */
export type FacetasResolvidas = {
  cozinhas?: Cozinha[]
  categorias?: Categoria[]
  tags?: string[]
  restricoes?: Restricao[]
  dificuldade?: FaixaResolvida
  porcoes?: FaixaResolvida
}

/**
 * Mapa estático intenção→facetas (MVP, language-neutral; #14 troca por embeddings).
 * Chave = token JÁ NORMALIZADO pelo `foldIntent` (lower + strip de diacríticos +
 * hífen→espaço), idêntico ao fold observável de #9. Seedado para o exemplo do AC3
 * ("asiático e leve") resolver de fato: 'asiatico' → cozinhas asiáticas; 'leve' →
 * tag 'leve' + dificuldade baixa.
 */
export const CULINARY_INTENT_MAP = {
  asiatico: { cozinhas: ['japonesa', 'chinesa', 'tailandesa', 'indiana'] },
  asian: { cozinhas: ['japonesa', 'chinesa', 'tailandesa', 'indiana'] },
  leve: { tags: ['leve'], dificuldade: { max: 2 } },
  light: { tags: ['leve'], dificuldade: { max: 2 } },
  vegano: { restricoes: ['vegano'] },
  vegan: { restricoes: ['vegano'] },
  vegetariano: { restricoes: ['vegetariano'] },
  vegetarian: { restricoes: ['vegetariano'] },
  sobremesa: { categorias: ['sobremesa'] },
  dessert: { categorias: ['sobremesa'] },
} as const satisfies Record<string, FacetasResolvidas>

/** Conectores ignorados na tokenização (stoplist mínima language-neutral). */
const STOPWORDS = new Set(['e', 'and', 'com', 'with', 'de', 'of'])

/**
 * Fold de #9 em JS: lower + strip de diacríticos (NFD + remove U+0300..U+036F) +
 * hífen→espaço. Equivalente observável a `lower(immutable_unaccent(replace(x,'-',' ')))`
 * para o latim que importa (asiático→asiatico, Saudável→saudavel, cebola-roxa→cebola roxa).
 * Reescrito com a classe combining-marks VISÍVEL (̀-ͯ) para o arquivo permanecer
 * text-diffável.
 */
export function foldIntent(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/-/g, ' ')
    .trim()
}

export type ProfileResolution = {
  /** Facetas resolvidas a UNIR (merge dos hits do mapa). Vazio se nada casou. */
  facetas: FacetasResolvidas
  /** true sse ALGUM token casou o mapa (=> emitir `consulta` no DTO + permitir faceta-only). */
  resolved: boolean
  /**
   * q a seguir dirigindo o FTS/ingrediente de #6/#9. CONTRATO (emenda 1):
   *  - resolved===false: igual a `q0` VERBATIM (byte-a-byte; NÃO re-tokeniza, vírgulas
   *    preservadas — load-bearing pro eixo de Ingrediente de #9, onde a vírgula separa
   *    termos e perdê-la colapsa N e quebra match=all).
   *  - resolved===true: tokens NÃO-casados re-juntados por `', '` (vírgula+espaço), para
   *    `parseSearchTerms` recuperar os termos distintos.
   */
  remainingQuery: string
}

/** Une duas faixas tomando a MAIS RESTRITIVA (min mais alto, max mais baixo). */
function mergeFaixa(a: FaixaResolvida | undefined, b: FaixaResolvida): FaixaResolvida {
  if (a === undefined) return { ...b }
  const merged: FaixaResolvida = { ...a }
  if (b.min !== undefined) merged.min = merged.min === undefined ? b.min : Math.max(merged.min, b.min)
  if (b.max !== undefined) merged.max = merged.max === undefined ? b.max : Math.min(merged.max, b.max)
  return merged
}

/** Concatena+dedup um eixo de array. */
function mergeArray<T>(a: T[] | undefined, b: readonly T[]): T[] {
  return [...new Set([...(a ?? []), ...b])]
}

/** Funde os hits do mapa num único conjunto de facetas resolvidas. */
function mergeFacetas(acc: FacetasResolvidas, hit: FacetasResolvidas): FacetasResolvidas {
  const out: FacetasResolvidas = { ...acc }
  if (hit.cozinhas) out.cozinhas = mergeArray(out.cozinhas, hit.cozinhas)
  if (hit.categorias) out.categorias = mergeArray(out.categorias, hit.categorias)
  if (hit.tags) out.tags = mergeArray(out.tags, hit.tags)
  if (hit.restricoes) out.restricoes = mergeArray(out.restricoes, hit.restricoes)
  if (hit.dificuldade) out.dificuldade = mergeFaixa(out.dificuldade, hit.dificuldade)
  if (hit.porcoes) out.porcoes = mergeFaixa(out.porcoes, hit.porcoes)
  return out
}

/**
 * Resolve a intenção difusa do `?q=` contra o mapa estático.
 *
 * Tokeniza por whitespace E vírgula (a vírgula já é separador de termos em #9), aplica
 * `foldIntent` por token, dropa stopwords, e casa cada token (unigramas) contra o mapa.
 * Tokens casados são CONSUMIDOS (viram facetas); os não-casados formam o q-restante.
 *
 * Os tokens restantes carregam a SURFACE FORM original (não-foldada) — a normalização da
 * lente serve só para CASAR o mapa, nunca para reescrever o que segue ao FTS.
 */
export function resolveCulinaryProfile(q: string): ProfileResolution {
  // Particiona em unidades atômicas preservando se cada uma foi um termo-de-vírgula.
  // Cada elemento de `q.split(',')` é um termo de #9; dentro dele, split por whitespace.
  const segments = q.split(',')

  let facetas: FacetasResolvidas = {}
  let resolved = false
  // Tokens NÃO-casados, agrupados por termo-de-vírgula (preserva a fronteira de termo).
  const remainingTerms: string[] = []

  for (const segment of segments) {
    const words = segment.split(/\s+/).filter((w) => w.length > 0)
    const kept: string[] = []
    for (const word of words) {
      const folded = foldIntent(word)
      if (folded.length === 0 || STOPWORDS.has(folded)) {
        // Stopword/vazio: consumido SILENCIOSAMENTE (não casa, não vaza pro FTS).
        continue
      }
      const hit = (CULINARY_INTENT_MAP as Record<string, FacetasResolvidas>)[folded]
      if (hit) {
        facetas = mergeFacetas(facetas, hit)
        resolved = true
      } else {
        kept.push(word)
      }
    }
    if (kept.length > 0) remainingTerms.push(kept.join(' '))
  }

  // Contrato do remainingQuery:
  //  - nada casou: devolve q0 VERBATIM (byte-a-byte). reduce-to-#9 intacto.
  //  - algo casou: re-junta os termos restantes por ', ' (parseSearchTerms re-splita).
  const remainingQuery = resolved ? remainingTerms.join(', ') : q

  return { facetas, resolved, remainingQuery }
}
