/**
 * Tipos de leitura do painel de CUSTO de IA no /admin (#465) — a vista agregada dos DOIS ledgers de
 * custo: `generation` (texto, #463) + `image_generation` (imagem, #224). PUROS (sem I/O): o servidor
 * (`loadAiCostSummary`) os produz e a UI (`AiCostSection`) os consome. Todo valor USD já vem em número
 * (float8 do lado do SQL) — precisão de dashboard, não de contabilidade (o SNAPSHOT contábil imutável
 * vive nas linhas dos ledgers; aqui só somamos para dar visibilidade de margem/abuso).
 *
 * Best-effort/NULL-honesto: linhas sem telemetria (cost_usd NULL) NÃO entram nas somas (não fingem 0);
 * assim o total reflete só o que foi realmente medido.
 */

/** Custo de UM dia, separado por ledger (texto × imagem). `day` = 'YYYY-MM-DD' (UTC). */
export type AiCostDay = {
  day: string
  textUsd: number
  imageUsd: number
}

/** Custo acumulado de UM usuário na janela (top-N por total). `handle`/`email` para exibição. */
export type AiCostUser = {
  userId: string
  handle: string | null
  email: string
  textUsd: number
  imageUsd: number
  totalUsd: number
}

/**
 * Custo da geração de TEXTO correlacionado ao DESFECHO (engajamento). `total*` = todas as gerações com
 * Receita e custo na janela; `saved*` = as cujas Receitas foram SALVAS por alguém (≥1 recipe_save);
 * `starred*` = as cujas Receitas foram AVALIADAS (≥1 recipe_review). Saved e starred se SOBREPÕEM (uma
 * Receita pode ter os dois) — são dois indicadores de "gasto que virou engajamento", não uma partição.
 */
export type AiCostByOutcome = {
  totalUsd: number
  totalCount: number
  savedUsd: number
  savedCount: number
  starredUsd: number
  starredCount: number
}

/** Resposta completa do painel: janela + totais + série diária + top usuários + desfecho. */
export type AiCostSummary = {
  windowDays: number
  totals: { textUsd: number; imageUsd: number; totalUsd: number }
  perDay: AiCostDay[]
  topUsers: AiCostUser[]
  byOutcome: AiCostByOutcome
}

/** Janela default do painel (dias). Mantida em código (não é config de produto). */
export const AI_COST_DEFAULT_WINDOW_DAYS = 30
/** Quantos usuários no ranking (top-N). */
export const AI_COST_TOP_USERS = 10

/** Formata um valor USD para exibição (4 casas — sub-centavo, frações de geração somam). PURO. */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(4)}`
}
