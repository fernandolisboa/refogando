/**
 * Popularidade (issue #368, ADR-0027/0028) — módulo PURO: tipos + defaults + a MISTURA ponderada que
 * substitui `vote_count` (Busca) e `apreço=votos+favoritos` (Cozinheiros). Sem DB/I/O: as funções são
 * a fonte da verdade da FORMA do score; o SQL de `search.ts`/`recommended-cooks.ts` espelha a fórmula
 * EXATA (com `::float8` em toda divisão — divisão inteira zeraria o prior). As constantes tunáveis
 * vivem em `app_config` (`parsePopularityConfig` valida o PUT do admin).
 *
 * TRÊS SINAIS (ADR-0027 dec.5): SAVE (apreço abundante, low-friction — evita o cold-start), NOTA
 * (qualidade, via Bayesiana com shrinkage) e FRESCOR (recência, decay exponencial). Self-apreciação é
 * excluída no write-path do SQL, não aqui (isto é aritmética pura).
 *
 * FRESCOR / TAU / M = CALIBRAGEM REVERSÍVEL: a FORMA (exp-decay + Bayesiana) é travada pelo ADR-0027
 * dec.5; os NÚMEROS (DEFAULT_POPULARITY_CONFIG) são knobs de produto, ajustáveis pelo admin sem deploy.
 */

/** Pesos dos três sinais. `>= 0` (0 desliga um termo). */
export type PopularityWeights = { wSave: number; wNota: number; wNovo: number }

/**
 * Config completa: pesos + `m` (força do prior Bayesiano — quantas notas "de confiança" o prior vale) +
 * `tauDays` (constante de tempo do frescor, em dias). `m>0` e `tauDays>0` ESTRITOS.
 */
export type PopularityConfig = PopularityWeights & { m: number; tauDays: number }

/**
 * Default (calibragem reversível). wSave=wNota=1 (save e nota pesam igual), wNovo=0,5 (frescor é um
 * empurrão, não o eixo dominante), m=20 (uma receita precisa de ~20 notas pra a média própria dominar
 * o prior C), tauDays=30 (meia-vida de frescor ~3 semanas). Ajustável em `/admin` sem migração.
 */
export const DEFAULT_POPULARITY_CONFIG: PopularityConfig = {
  wSave: 1,
  wNota: 1,
  wNovo: 0.5,
  m: 20,
  tauDays: 30,
}

/**
 * Frescor(idade) ∈ (0,1], decay exponencial. `ageDays<=0 ⇒ 1` (clamp de skew de relógio — uma receita
 * "do futuro" não ganha frescor > 1). PURO/TOTAL. Espelha `exp(-EXTRACT(EPOCH...)/86400/tau)` no SQL.
 */
export function frescor(ageDays: number, tauDays: number): number {
  if (!(ageDays > 0)) return 1
  return Math.exp(-ageDays / tauDays)
}

/**
 * Média Bayesiana (shrinkage pra C = média global). `v>0 ? (v/(v+m))·R + (m/(v+m))·C : C`. Com poucas
 * notas o resultado é PUXADO pra C (confiança-por-volume, guarda-corpo (a)); com muitas, converge pra R.
 * `v<=0 ⇒ C` (prior puro; também evita 0/0). PURO/TOTAL.
 */
export function bayesianRating(R: number, v: number, C: number, m: number): number {
  if (!(v > 0)) return C
  return (v / (v + m)) * R + (m / (v + m)) * C
}

/**
 * Score de RECEITA (Busca). `wSave·ln(1+saves) + wNota·bayes(nota) + wNovo·frescor`. O `ln` amortece o
 * apreço (retornos decrescentes de saves). `saves` é clampado a `max(0,·)` (defensivo). O termo de
 * frescor É ADITIVO aqui — a Busca não pagina por keyset de score, então `now()` é seguro.
 */
export function popularityScore(input: {
  saves: number
  ratingAvg: number
  ratingCount: number
  ageDays: number
  globalAvg: number
  config: PopularityConfig
}): number {
  const { saves, ratingAvg, ratingCount, ageDays, globalAvg, config } = input
  const s = Math.max(0, saves)
  return (
    config.wSave * Math.log(1 + s) +
    config.wNota * bayesianRating(ratingAvg, ratingCount, globalAvg, config.m) +
    config.wNovo * frescor(ageDays, config.tauDays)
  )
}

/**
 * Score de COZINHEIRO (trilho/diretório de recomendados). SEM termo de frescor ADITIVO — o `/cooks`
 * PAGINA por keyset `(score, recency, handle)`; um score com `now()` mudaria a cada request e o
 * cozinheiro da borda DUPLICARIA a cada "load more". A recência (`max(created_at)`) fica de DESEMPATE
 * no ORDER BY, não dentro do score. Isso realiza "frescor" de forma time-independent E é mais fiel à
 * forma antiga do apreço (recência já era o desempate). `wSave·ln(1+saves) + wNota·bayes(nota)`.
 */
export function cookScore(input: {
  saves: number
  ratingAvg: number
  ratingCount: number
  globalAvg: number
  config: PopularityConfig
}): number {
  const { saves, ratingAvg, ratingCount, globalAvg, config } = input
  const s = Math.max(0, saves)
  return (
    config.wSave * Math.log(1 + s) +
    config.wNota * bayesianRating(ratingAvg, ratingCount, globalAvg, config.m)
  )
}

export type PopularityConfigParse = { ok: true; value: PopularityConfig } | { ok: false }

/**
 * `Number.isFinite` é OBRIGATÓRIO em TODOS os campos: `±Infinity`/`NaN` não são config válida e
 * `Infinity > 0` é `true` (um guard naive `w > 0` deixaria Infinity passar e envenenaria o score).
 */
function isNonNegWeight(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}
function isPositiveFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

/**
 * Valida o objeto `popularity` cru do PUT do admin (substituição COMPLETA — a UI envia os 5 campos).
 * Pesos: finito e `>= 0`. `m`: finito e `> 0` ESTRITO — rejeitar `m<=0` NÃO é por NaN (o guard `v<=0⇒C`
 * já cobre isso), é porque `m<=0` DESLIGA o guarda-corpo (a) (sem shrinkage pra C). `tau`: finito e
 * `> 0`. Qualquer desvio ⇒ `{ ok: false }` (o route mapeia a 400). Espelha `parseImageGenConfig`
 * (contrato fechado, sem `as` no valor). PURO: sem DB/I/O.
 */
export function parsePopularityConfig(raw: unknown): PopularityConfigParse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false }
  const obj = raw as {
    wSave?: unknown
    wNota?: unknown
    wNovo?: unknown
    m?: unknown
    tauDays?: unknown
  }
  if (!isNonNegWeight(obj.wSave)) return { ok: false }
  if (!isNonNegWeight(obj.wNota)) return { ok: false }
  if (!isNonNegWeight(obj.wNovo)) return { ok: false }
  if (!isPositiveFinite(obj.m)) return { ok: false }
  if (!isPositiveFinite(obj.tauDays)) return { ok: false }
  return {
    ok: true,
    value: { wSave: obj.wSave, wNota: obj.wNota, wNovo: obj.wNovo, m: obj.m, tauDays: obj.tauDays },
  }
}
