/**
 * Tetos do limitador persistido do app (#643, #648, ADR-0057). PURO: só constantes e o cálculo da janela; o upsert
 * mora em `src/server/rate-limit/window.ts`.
 *
 * Janela FIXA alinhada à época (`windowStartOf`): todas as instâncias caem na mesma janela sem combinar nada, e a
 * chave da linha é (bucket, key, window_start). Na virada da janela o contador recomeça; quem estava bloqueado passa
 * de novo. O pior caso de uma janela fixa (2 × limite em volta da virada) é aceito: os tetos são anti-abuso, não cota.
 *
 * Toda janela com chave de pessoa (IP ou conta) dura no máximo 30 min: com a limpeza de hora em hora, o código do IP
 * sai em até ~1 h 30 depois da janela abrir, dentro das "até 2 horas" da política (item 3.6).
 */

export type RateLimitBucket =
  | 'search_embed_ip'
  | 'search_embed_user'
  | 'search_embed_global_anon'
  | 'search_embed_global_user'
  | 'takedown_ip'
  | 'takedown_global'
  | 'dpo_email_arrival'
  | 'dpo_email_sla'
  | 'dpo_email_day'
  | 'client_error_global'

export type RateLimitPolicy = { limit: number; windowMs: number }

const MIN = 60_000
const HORA = 60 * MIN
const DIA = 24 * HORA

/**
 * Os tetos. Os de busca valem só para o vetor da consulta (a chamada paga ao Gemini): acima deles a busca segue,
 * só pela parte textual (FTS), como quando o Gemini falha. Os do formulário de Seus direitos barram o envio (429).
 */
export const RATE_LIMITS: Record<RateLimitBucket, RateLimitPolicy> = {
  // Visitante, por IP (IPv6 pela /64). A busca dispara a cada pausa de 300 ms na digitação (~5–8 vetores por
  // termo digitado); 30 em 10 min cobre umas 4–6 buscas digitadas, e o cache tira as repetidas da conta. Acima
  // disso a busca continua, sem a parte semântica.
  search_embed_ip: { limit: 30, windowMs: 10 * MIN },
  // Pessoa logada, pela conta (não pelo IP: várias contas atrás do mesmo NAT não se atrapalham).
  search_embed_user: { limit: 120, windowMs: 10 * MIN },
  // Tetos de TODOS os vetores de busca por minuto: protegem a chave do Gemini, que é a mesma das imagens e do
  // vetor das receitas, de um laço vindo de muitos IPs. Visitantes e pessoas logadas têm baldes SEPARADOS: um laço
  // anônimo esgota só o dos visitantes, e quem tem conta segue com a busca semântica. Juntos, até 120 por minuto.
  search_embed_global_anon: { limit: 60, windowMs: MIN },
  search_embed_global_user: { limit: 60, windowMs: MIN },
  // Formulário público de Seus direitos (notificação de retirada / pedido do titular): por IP e no total.
  takedown_ip: { limit: 5, windowMs: 30 * MIN },
  takedown_global: { limit: 30, windowMs: HORA },
  // E-mails ao canal de privacidade, que saem pelo Resend, a mesma cota dos e-mails de cadastro e de senha (plano
  // grátis: 100 por dia, ADR-0014). Três regras com chave `global`:
  //  - aviso de chegada de ticket: 5 por hora, e no máximo `DPO_ARRIVAL_DAY_SHARE` do teto diário;
  //  - alerta de SLA por ticket (vermelho/vencido, prazo legal): balde próprio por hora, que a chegada não gasta;
  //  - teto DIÁRIO somando os dois (janela de 24 h alinhada à meia-noite UTC). O alerta de SLA usa o teto inteiro e a
  //    chegada só a parte dela, então sobram sempre `limite - DPO_ARRIVAL_DAY_SHARE` para os alertas de prazo.
  // O resumo diário do cron `dsar-sla` fica fora dos tetos: 1 por dia, e é ele que avisa o que os tetos seguraram.
  dpo_email_arrival: { limit: 5, windowMs: HORA },
  dpo_email_sla: { limit: 10, windowMs: HORA },
  dpo_email_day: { limit: 20, windowMs: DIA },
  // Linhas `[erro] origem=cliente` por minuto somando TODAS as instâncias (o teto por instância continua em memória).
  client_error_global: { limit: 300, windowMs: MIN },
}

/**
 * Parte do teto diário `dpo_email_day` que o aviso de CHEGADA pode usar. A chegada consome a mesma linha com este
 * limite menor (o upsert só soma enquanto `count < limite` de quem chama), então o alerta de SLA, que consome com o
 * limite cheio, tem sempre `RATE_LIMITS.dpo_email_day.limit - DPO_ARRIVAL_DAY_SHARE` reservados no dia.
 */
export const DPO_ARRIVAL_DAY_SHARE = 10

/** Chave dos tetos que somam todo mundo (não identifica ninguém). */
export const GLOBAL_LIMIT_KEY = 'global'

/** Início da janela fixa que contém `nowMs` (múltiplo de `windowMs` desde a época). */
export function windowStartOf(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * windowMs
}
