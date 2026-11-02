/**
 * Guardas de custo da tradução sob demanda (#642, ADR-0056) — PURO. A tradução por LLM
 * (`ensureTranslation`) não tinha teto: uma falha (estouro de `max_tokens`, reprovação na fidelidade) não
 * gravava nada e cada POST chamava o modelo de novo; POSTs simultâneos na 1ª tradução chamavam uma vez cada; a
 * entrada não tinha tamanho máximo. Aqui ficam as constantes e as decisões puras; o I/O (lease, cache de falha,
 * reserva de cota) vive em `src/server/translation/flight.ts`.
 */

import { capFromRoleTable, type Role } from '@/domain/user'
import { TRANSLATION_MAX_TOKENS } from '@/domain/translation-prompt'

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
 * Teto do tamanho da entrada enviada ao tradutor, em caracteres (título + descrição + passos + notas + nomes de
 * ingrediente + cozinha). A saída tem o tamanho da entrada mais o JSON, e o teto de saída é
 * `TRANSLATION_MAX_TOKENS` (4096, ~3 a 4 caracteres por token): uma entrada acima disso estoura o `max_tokens` e
 * paga a chamada para nada. Fica abaixo do que caberia, com folga para o JSON.
 */
export const TRANSLATION_MAX_INPUT_CHARS = TRANSLATION_MAX_TOKENS * 3

/** O que o tradutor recebe (mesma forma de `TranslateInput`, só o texto). */
export type TranslationInputText = {
  fields: { titulo: string; descricao?: string | null; passos?: string[] | null; notas?: string | null }
  ingredientes?: ReadonlyArray<{ nome: string }>
  cozinha?: string | null
}

/** Tamanho, em caracteres, do texto que iria ao tradutor. */
export function translationInputChars(input: TranslationInputText): number {
  const { fields } = input
  let total = fields.titulo.length + (fields.descricao?.length ?? 0) + (fields.notas?.length ?? 0)
  for (const p of fields.passos ?? []) total += p.length
  for (const i of input.ingredientes ?? []) total += i.nome.length
  return total + (input.cozinha?.length ?? 0)
}

/** A entrada passa do teto ⇒ não chama o modelo (a receita fica no original, como numa falha). */
export function isTranslationInputTooLarge(input: TranslationInputText): boolean {
  return translationInputChars(input) > TRANSLATION_MAX_INPUT_CHARS
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
