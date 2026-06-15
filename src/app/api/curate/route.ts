import { requireRole } from '@/server/auth/guard'

/**
 * SENTINELA DE GATING — NÃO é curadoria real (issue #5, #5.AC1). Existe só para provar o
 * degrau de papel Usuário→Curador de forma honesta, sem inventar telas de catálogo (fora
 * de escopo desta fatia). `requireRole(req,'curador')`: Visitante → 401; `usuario` → 403
 * `papel_insuficiente`; `curador`/`admin` → 200 `{ ok:true }`. A curadoria de catálogo
 * de verdade (revisar reportadas, etc.) é trabalho de uma fatia futura.
 */
export async function POST(req: Request): Promise<Response> {
  const g = await requireRole(req, 'curador')
  if (!g.ok) return g.response
  return Response.json({ ok: true })
}
