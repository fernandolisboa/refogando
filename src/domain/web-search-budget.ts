/**
 * Teto de GASTO da descoberta na web (#464, SEC/INFRA) — PURO: só a constante do teto diário e o
 * helper de "dia de calendário". O endpoint `/api/discovery/web` é ANÔNIMO e dispara até
 * `MAX_SITE_QUERIES` consultas Brave por chamada; o kill-switch `webSearchEnabled` é um INTERRUPTOR,
 * não um teto. Aqui mora o teto: um CONTADOR global de consultas por dia, com um limite duro em código.
 *
 * Por que consultas (não dólares)? Cada consulta Brave é UMA chamada de API de custo ~fixo — contar
 * consultas é o proxy direto do gasto (sem precisar de tabela de preço). Estourou o teto do dia ⇒ o
 * endpoint DEGRADA para `{ results: [] }` (nunca erro), como já faz quando desligado/allowlist vazia.
 *
 * O teto é constante EM CÓDIGO (não app_config): é um DISJUNTOR de segurança/custo, não uma preferência
 * que o admin ajusta no dia a dia. Reversível por deploy se precisar recalibrar.
 */

/**
 * Teto DURO de consultas Brave por dia (UTC), GLOBAL (soma de todos os visitantes anônimos). Dimensiona
 * um circuit-breaker de custo, não o uso normal: no pior caso (fan-out cheio de `MAX_SITE_QUERIES=8`)
 * são ~250 chamadas ao endpoint/dia antes de degradar — folga ampla para tráfego legítimo, teto rígido
 * contra abuso/loop. Ajustável por deploy (é uma trava, não uma config de admin).
 */
export const DAILY_WEB_SEARCH_QUERY_CAP = 2000

/**
 * Chave do "dia de calendário" (UTC) do contador — `YYYY-MM-DD`. UTC (não fuso local) para que a
 * virada do contador seja determinística e independente da timezone do processo/DB. Usada como PK da
 * linha do dia em `web_search_usage_daily`; o teto zera sozinho na virada (o dia seguinte é outra linha).
 */
export function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10)
}
