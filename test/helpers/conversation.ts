import { POST } from '@/app/api/conversations/stream/route'
import type { TranscriptMessage } from '@/domain/transcript'

/**
 * Helpers do modo conversa (#12). Espelham `test/helpers/generation.ts`:
 *  - `makeTranscript`: fixture de Transcrição válida (multi-turno terminando em user).
 *  - `cannedTokens*`: builders de fluxo de tokens enlatado para o `FakeClaudeClient`
 *    (3º arg do construtor).
 *  - `postStream`: chama o handler POST de /api/conversations/stream.
 *  - `collectNdjson`: lê o corpo NDJSON do `Response` e devolve os frames parseados —
 *    `res.json()` estoura num corpo NDJSON (não é um único JSON), então este helper é o
 *    alvo verde para ler o stream.
 */

// ── Frames do contrato NDJSON (união discriminada) ────────────────────────────────
export type NdjsonFrame =
  | { type: 'token'; text: string }
  | {
      type: 'recipe'
      outcome: 'success' | 'degraded' | 'playful'
      recipeId: string | null
      advisory: string | null
      avisos?: { kind: string; restricao: string; alergeno: string; mensagem: string }[]
    }
  | { type: 'impossible'; advisory: string | null }
  | { type: 'error'; error: 'geracao_invalida' }

/** Transcrição "pedido" válida por default (multi-turno, última fala do usuário). */
export function makeTranscript(overrides?: TranscriptMessage[]): TranscriptMessage[] {
  return (
    overrides ?? [
      { role: 'user', content: 'quero uma receita de arroz' },
      { role: 'assistant', content: 'com algum acompanhamento?' },
      { role: 'user', content: 'arroz de forno com queijo' },
    ]
  )
}

/** Fluxo de tokens enlatado (default: alguns deltas em ordem). */
export function cannedTokens(tokens: string[] = ['Vou ', 'pensar ', 'numa receita…']): string[] {
  return tokens
}

/** POST /api/conversations/stream com corpo JSON (+ headers de sessão opcionais). */
export function postStream(body: unknown, headers?: Headers): Promise<Response> {
  return POST(
    new Request('http://localhost/api/conversations/stream', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

/**
 * Lê o corpo NDJSON do `Response`: cada linha é UM frame JSON. Trima, separa por '\n' e
 * parseia cada linha. Tolera linha final vazia (terminador de linha). `res.json()` estoura
 * num corpo multi-linha — este é o jeito certo de ler o stream nos testes.
 */
export async function collectNdjson(res: Response): Promise<NdjsonFrame[]> {
  const text = await res.text()
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as NdjsonFrame)
}
