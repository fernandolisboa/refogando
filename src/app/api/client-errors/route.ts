import { createClientErrorIntake } from '@/server/http/client-error-intake'

/**
 * Relato de erro do navegador (issue #590, ADR-0048): `POST { v:1, tipo, rota, erro, msg?, digest? }` ⇒ 204
 * e uma linha `[erro] origem=cliente …` no log. Sem sessão, sem banco. Regras e limites em
 * `src/server/http/client-error-intake.ts`; catálogo das linhas em `docs/observabilidade.md`.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Módulo-escopo: os limites (por IP e por instância) persistem entre requests da mesma instância.
const intake = createClientErrorIntake()

export async function POST(request: Request): Promise<Response> {
  return intake(request)
}
