import { createClientErrorIntake } from '@/server/http/client-error-intake'
import { getDb } from '@/server/deps'
import { consumeRateLimit } from '@/server/rate-limit/window'
import { GLOBAL_LIMIT_KEY } from '@/domain/rate-limit-rules'

/**
 * Relato de erro do navegador (issue #590, ADR-0048): `POST { v:1, tipo, rota, erro, msg?, digest? }` ⇒ 204
 * e uma linha `[erro] origem=cliente …` no log. Sem sessão; do banco, só o teto global de linhas por minuto (#648).
 * Regras e limites em `src/server/http/client-error-intake.ts`; catálogo das linhas em `docs/observabilidade.md`.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Módulo-escopo: os limites (por IP e por instância) persistem entre requests da mesma instância. O teto global
// (#648, ADR-0057) é persistido no banco, com a chave 'global' (sem IP); `getDb()` sem banco lança ⇒ fail-open.
const intake = createClientErrorIntake({
  globalCap: async () => (await consumeRateLimit(getDb(), { bucket: 'client_error_global', key: GLOBAL_LIMIT_KEY })).allowed,
})

export async function POST(request: Request): Promise<Response> {
  return intake(request)
}
