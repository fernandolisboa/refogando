/**
 * Transcrição da conversa — domínio PURO (issue #12/#15, modo conversa).
 *
 * A Transcrição é a ENTRADA do modo `conversation`: uma lista alternada de falas do
 * Usuário e do Assistente, terminando SEMPRE numa fala do Usuário (é a vez do Usuário
 * que dispara a destilação). #12 muda só a ENTRADA — a saída segue o mesmo
 * `RecipeGenSchema` canônico, classificada por `classify`. Este módulo é
 * PURO/TOTAL/SEM THROW e sem DB: espelha o estilo `parseBriefing` de `briefing.ts`
 * (discriminated union, primeiro erro vence, faixas validadas no app).
 *
 * #15: `TRANSCRIPT_ROLES` vira o KERNEL do pgEnum `transcript_role` (a tabela durável
 * `transcript_message` nasce agora) — fonte única, espelhando como `STRENGTHS`/`ROLES`
 * alimentam `schema.ts`. O teto por mensagem reusa `OBSERVACOES_MAX` (fonte única de #11)
 * — mesma faixa simétrica que o texto livre e as observações já adotam.
 */

import { OBSERVACOES_MAX } from '@/domain/briefing'

// ── Papéis da fala (KERNEL do pgEnum `transcript_role`, #15) ────────────────────
export const TRANSCRIPT_ROLES = ['user', 'assistant'] as const
export type TranscriptRole = (typeof TRANSCRIPT_ROLES)[number]
function isTranscriptRole(value: string): value is TranscriptRole {
  return (TRANSCRIPT_ROLES as readonly string[]).includes(value)
}

// Teto por mensagem: fonte única em OBSERVACOES_MAX (#11) — sem ele cada fala iria CRU
// pro prompt (custo de token ilimitado; Next.js não limita req.json() por padrão).
export const TRANSCRIPT_MESSAGE_MAX = OBSERVACOES_MAX
// Teto de falas por Transcrição (decisão reversível): generoso para uma conversa real,
// estreito o bastante para não inflar o prompt de destilação sem limite.
export const TRANSCRIPT_MAX_MESSAGES = 100

// ── Tipo do domínio ──────────────────────────────────────────────────────────────
export type TranscriptMessage = { role: TranscriptRole; content: string }

// ── Parse + validação de shape (body cru `unknown` → Transcript | erro) ──────────
// Discriminated-union sem throw (espelha `parseBriefing`/`classify`). O código de erro
// alimenta o 400 do handler ANTES de abrir o stream.
export type TranscriptParse =
  | { ok: true; transcript: TranscriptMessage[] }
  | {
      ok: false
      error:
        | 'transcript_invalido' // não-array
        | 'transcript_vazio' // array vazio
        | 'mensagem_invalida' // shape de item errado (não-objeto, role/content inválidos)
        | 'mensagem_muito_longa' // content > TRANSCRIPT_MESSAGE_MAX
        | 'transcript_muito_longo' // mais de TRANSCRIPT_MAX_MESSAGES falas
        | 'ultima_fala_nao_usuario' // a última fala não é do Usuário
    }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Total: recebe o `unknown` e devolve a união discriminada. Ordem: array → não-vazio →
 * contagem → shape-de-cada-mensagem (role/content/comprimento) → última-fala-do-usuário.
 * Cada falha devolve o PRIMEIRO erro. Faixas validadas AQUI, no app (ADR-0009).
 */
export function parseTranscript(raw: unknown): TranscriptParse {
  // 1. array.
  if (!Array.isArray(raw)) return { ok: false, error: 'transcript_invalido' }
  // 2. não-vazio.
  if (raw.length === 0) return { ok: false, error: 'transcript_vazio' }
  // 3. contagem.
  if (raw.length > TRANSCRIPT_MAX_MESSAGES) return { ok: false, error: 'transcript_muito_longo' }

  // 4. shape de cada mensagem.
  const messages: TranscriptMessage[] = []
  for (const m of raw) {
    if (!isPlainObject(m)) return { ok: false, error: 'mensagem_invalida' }
    if (typeof m.role !== 'string' || !isTranscriptRole(m.role)) {
      return { ok: false, error: 'mensagem_invalida' }
    }
    if (typeof m.content !== 'string' || m.content.trim() === '') {
      return { ok: false, error: 'mensagem_invalida' }
    }
    if (m.content.length > TRANSCRIPT_MESSAGE_MAX) {
      return { ok: false, error: 'mensagem_muito_longa' }
    }
    messages.push({ role: m.role, content: m.content })
  }

  // 5. a última fala precisa ser do Usuário (é a vez dele que dispara a destilação).
  if (messages[messages.length - 1].role !== 'user') {
    return { ok: false, error: 'ultima_fala_nao_usuario' }
  }

  return { ok: true, transcript: messages }
}

// ── Atribuição de `seq` (PURA, #15) ──────────────────────────────────────────────
/**
 * Próximo `seq` monotônico a partir dos `seq` já existentes de uma sessão. Total/puro:
 * lista vazia → 0 (1ª mensagem); senão `max + 1`. É a forma pura por trás do
 * `coalesce(max(seq),-1)+1` que o route executa DENTRO da transação — o índice UNIQUE
 * `(creation_session_id, seq)` é a rede de banco contra qualquer atribuição em corrida.
 */
export function nextSeq(existing: readonly number[]): number {
  return existing.length === 0 ? 0 : Math.max(...existing) + 1
}
