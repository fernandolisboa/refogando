/**
 * Parsing de timer efêmero a partir do TEXTO de um passo (#455) — PURO, sem DOM/React/IA.
 *
 * LANDMINE INEGOCIÁVEL (ADR-0023, decisão 1): "tempo por passo" foi EXPLICITAMENTE REJEITADO como
 * DADO — os passos (`recipe_translation.passos`, `text[]`) são conteúdo TRADUZÍVEL sem identidade
 * estável entre locales (o nº de passos pode divergir pt-BR/en-US), então atrelar um tempo
 * estruturado a um passo seria incoerente. Este módulo NÃO viola isso: o "timer" aqui é um
 * HEURÍSTICO EFÊMERO calculado no CLIENTE a partir da STRING do passo já carregada — nunca um
 * campo novo no schema, nunca persistido, nunca uma segunda fonte de verdade pro tempo (que
 * continua sendo só `tempo_ativo_min`/`tempo_total_min`, ADR-0023). Se o texto mudar (edição,
 * re-tradução), o botão de timer simplesmente recalcula na próxima leitura — sem sincronização.
 *
 * Reconhece "N hora(s)" e "N minuto(s)/min(s)" (case-insensitive, pt-BR e en-US: hour(s)/minute(s)/
 * min(s)), somando os dois quando ambos aparecem ("1 hora e 30 minutos" / "1 hour 30 minutes").
 * DELIBERADAMENTE não reconhece a abreviação nua "h" (ex. "20h"): colidiria com horário do relógio
 * ("às 20h") em vez de duração — melhor NÃO oferecer timer que oferecer um errado.
 */

const HOUR_RE = /(\d+)\s*(?:horas?|hours?)\b/i
const MINUTE_RE = /(\d+)\s*(?:minutos?|min(?:ute)?s?)\b/i

export type ParsedStepTimer = { minutes: number }

/**
 * Extrai a duração (minutos) mencionada no texto de UM passo, se houver. `null` quando o passo
 * não menciona nenhuma duração reconhecível (a maioria dos passos — "misture os ingredientes").
 * Soma horas + minutos quando ambos aparecem na mesma frase. Nunca lança.
 */
export function parseStepTimer(text: string): ParsedStepTimer | null {
  const hourMatch = text.match(HOUR_RE)
  const minuteMatch = text.match(MINUTE_RE)
  const hours = hourMatch ? Number(hourMatch[1]) : 0
  const minutes = minuteMatch ? Number(minuteMatch[1]) : 0
  const total = hours * 60 + minutes
  if (!Number.isFinite(total) || total <= 0) return null
  return { minutes: total }
}
