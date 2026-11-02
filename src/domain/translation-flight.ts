/**
 * Guardas de custo da tradução sob demanda (#642, ADR-0056) — PURO. A tradução por LLM
 * (`ensureTranslation`) não tinha teto: uma falha (estouro de `max_tokens`, reprovação na fidelidade) não
 * gravava nada e cada POST chamava o modelo de novo; POSTs simultâneos na 1ª tradução chamavam uma vez cada; a
 * entrada não tinha tamanho máximo. Aqui ficam as constantes e as decisões puras; o I/O (lease, cache de falha,
 * reserva de cota) vive em `src/server/translation/flight.ts`.
 */

import { capFromRoleTable, type Role } from '@/domain/user'
import { TRANSLATION_MAX_TOKENS, buildTranslationUserPrompt } from '@/domain/translation-prompt'
import { retranslateFailKey } from '@/domain/translation-divergent-stale'
import type { ModelSettings } from '@/domain/ai-task-config'

/**
 * Duração do "em voo" (lease) de uma tradução por (receita, locale). Maior que o `maxDuration = 60` da rota (a
 * função morta pela Vercel não solta o lease; ele vence sozinho e o próximo POST tenta de novo). Enquanto vale,
 * os outros POSTs da mesma (receita, locale) não chamam o modelo.
 */
export const TRANSLATION_LEASE_MS = 90_000

/**
 * Cache negativo de uma falha DA LINHA (`UnusableTranslationError`: recusa, truncamento, saída inválida,
 * infidelidade). Tende a se repetir com a mesma fonte, então espera um dia. A chave (fonte + versão do prompt)
 * cai sozinha quando o original muda ou o tradutor sobe de versão — a mesma regra do circuit-breaker do #520.
 */
export const TRANSLATION_FAILURE_COOLDOWN_MS = 24 * 60 * 60 * 1000

/**
 * Cache negativo de uma falha de INFRAESTRUTURA (429/5xx/529, conexão, prazo, chave ausente). Curto: uma queda
 * do provedor não deve deixar a receita sem tradução por um dia, mas um laço de POSTs durante a queda também não
 * deve chamar o modelo a cada pedido.
 */
export const TRANSLATION_INFRA_FAILURE_COOLDOWN_MS = 10 * 60 * 1000

/**
 * Teto do pedido enviado ao tradutor (#642, ADR-0056 dec. 6), em BYTES UTF-8 do que vai ao modelo: o `userPrompt`
 * (`buildTranslationUserPrompt`, a fonte serializada em JSON, com aspas, vírgulas, `{"ordem":…,"nome":…}` e escapes)
 * mais a cozinha, a única parte do system prompt que varia por receita. Medir o texto cru deixava passar o que o
 * JSON infla: passos vazios (`""` são 3 bytes cada), milhares de ingredientes de 1 letra (~25 bytes cada) e
 * caracteres de controle (`\u0001` vira 6 bytes).
 *
 * Por que 8 KiB (`TRANSLATION_MAX_TOKENS × 2`): a saída é a mesma estrutura, traduzida. Tradução pt-BR ↔ en-US muda
 * o tamanho em até ~25%, e texto de receita em JSON fica em ~3 a 4 bytes por token. A 3 bytes/token, 8 KiB × 1,25
 * ≈ 3,4 mil tokens, abaixo dos 4096 do `max_tokens` com ~17% de folga. A maior receita do catálogo semeado tem
 * ~1,6 KiB de payload (5× abaixo do teto). Bytes, e não caracteres, porque o tokenizador trabalha em bytes: texto
 * fora do alfabeto latino (2 a 4 bytes por caractere) pesa mais, como pesa em tokens.
 */
export const TRANSLATION_MAX_PAYLOAD_BYTES = TRANSLATION_MAX_TOKENS * 2

/**
 * Tetos de contagem (checados antes de serializar, baratos). Cada passo e cada ingrediente vira um item na saída, e
 * item curto custa mais tokens por byte (estrutura JSON). O catálogo semeado tem no máximo 8 passos e 14
 * ingredientes; os tetos ficam muito acima do uso real.
 */
export const TRANSLATION_MAX_STEPS = 50
export const TRANSLATION_MAX_INGREDIENTS = 60

/** O que o tradutor recebe e que cresce com a receita (mesma forma de `TranslateInput`, só o texto). */
export type TranslationPayloadInput = {
  fields: { titulo: string; descricao?: string | null; passos?: string[] | null; notas?: string | null }
  ingredientes?: ReadonlyArray<{ ordem: number; nome: string }>
  cozinha?: string | null
}

const utf8 = new TextEncoder()

/** Bytes UTF-8 do que iria ao modelo e cresce com a receita: o `userPrompt` serializado + a cozinha. */
export function translationPayloadBytes(input: TranslationPayloadInput): number {
  const userPrompt = buildTranslationUserPrompt({ fields: input.fields, ingredientes: input.ingredientes })
  return utf8.encode(userPrompt).length + utf8.encode(input.cozinha?.trim() ?? '').length
}

/** O pedido passa de algum teto ⇒ não chama o modelo (a receita fica no original, como numa falha). */
export function isTranslationInputTooLarge(input: TranslationPayloadInput): boolean {
  if ((input.fields.passos?.length ?? 0) > TRANSLATION_MAX_STEPS) return true
  if ((input.ingredientes?.length ?? 0) > TRANSLATION_MAX_INGREDIENTS) return true
  return translationPayloadBytes(input) > TRANSLATION_MAX_PAYLOAD_BYTES
}

/**
 * Espera máxima pela advisory lock do PAR (receita, locale) no claim. Estourou ⇒ outro pedido está decidindo esse
 * par agora: o claim responde `in_progress` (200 no original), nunca 429 — quem espera é um terceiro, sem culpa da
 * fila. Curta, junto com a do usuário, para as esperas somarem no máximo ~4 s antes do prazo de 50 s do tradutor,
 * dentro do `maxDuration = 60` da rota.
 */
export const TRANSLATION_PAIR_LOCK_TIMEOUT_MS = 2_000

/**
 * Espera máxima pela lock de cota do USUÁRIO (4677) no claim, que acontece com a lock do par já tomada. Curta para
 * não segurar o par (e quem espera por ele) atrás da fila de um usuário só. Estourou ⇒ 429 `limite_traducao`.
 */
export const TRANSLATION_USER_LOCK_TIMEOUT_MS = 2_000

/**
 * Chave do cache negativo da tradução sob demanda: a chave do circuit-breaker do #520 (`retranslateFailKey`, fonte +
 * versão do prompt, sem mudança) acrescida do resto do que muda a saída do modelo: a cozinha (vai no system prompt)
 * e o modelo/ajuste da tarefa escolhidos no admin (ADR-0034). Trocar o modelo para corrigir um truncamento libera
 * na hora as receitas em cooldown. `modelConfig` nulo = tradutor sem config (dublês de teste).
 */
export function translationFlightFailKey(input: {
  sourceFingerprint: string
  promptVersion: number
  cozinha: string | null | undefined
  modelConfig: string | null | undefined
}): string {
  const base = retranslateFailKey(input.sourceFingerprint, input.promptVersion)
  return `${base}:c=${input.cozinha?.trim() || '-'}:m=${input.modelConfig || '-'}`
}

/** O modelo e o ajuste (thinking, esforço) da tarefa `translation` como texto, para `translationFlightFailKey`. */
export function translationModelConfigKey(task: { model: string; settings: ModelSettings }): string {
  return `${task.model}/${task.settings.thinking}/${task.settings.effort ?? '-'}`
}

/**
 * Traduções sob demanda que um usuário dispara em qualquer janela de 24h, por papel. `null` = ilimitado (admin).
 * Teto ANTI-ABUSO em código, como Derivar/Clonar (#588) e a Sugestão de cardápio: nenhuma tela chama a tradução
 * sob demanda hoje, então o uso legítimo fica longe disso. Só conta o POST que de fato chama o modelo: tradução
 * que já existe, em voo ou em cooldown não gasta slot.
 */
export const TRANSLATION_CAP_BY_ROLE: Record<Role, number | null> = {
  usuario: 30,
  curador: 60,
  admin: null,
}

/** Teto numérico do papel (`capFromRoleTable`: desconhecido ⇒ `usuario`, fail-closed; `null` ⇒ `Infinity`). */
export function capForTranslation(role: Role | null | undefined): number {
  return capFromRoleTable(TRANSLATION_CAP_BY_ROLE, role)
}

/**
 * Desfecho da tentativa de tomar o voo de uma (receita, locale), lido SOB a advisory lock do par:
 *  - `exists`: a tradução já foi gravada (outro voo terminou antes) — nada a fazer;
 *  - `in_progress`: outro pedido está com o lease valendo — este não chama o modelo;
 *  - `cooling_down`: a última tentativa falhou com a MESMA chave e o cache negativo ainda vale;
 *  - `go`: pode chamar (reserva a cota do usuário e toma o lease).
 */
export type TranslationFlightDecision = 'exists' | 'in_progress' | 'cooling_down' | 'go'

export function decideTranslationFlight(input: {
  translationExists: boolean
  leaseActive: boolean
  cooldownActive: boolean
  storedFailKey: string | null
  currentFailKey: string
}): TranslationFlightDecision {
  if (input.translationExists) return 'exists'
  if (input.leaseActive) return 'in_progress'
  // O cache negativo vale só para a MESMA tentativa: fonte editada ou prompt novo ⇒ pode tentar de novo.
  if (input.cooldownActive && input.storedFailKey === input.currentFailKey) return 'cooling_down'
  return 'go'
}
