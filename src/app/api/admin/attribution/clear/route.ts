import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { operatorClearSourceAttribution } from '@/server/recipe/operator-clear-attribution'

export const runtime = 'nodejs'

/** uuid canônico (a coluna `dsar_audit_event.case_id` é uuid — um caseId inválido estouraria 22P02). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Atendimento ao autor externo (titular B) pelo operador — #396/GAP-4 (`docs/legal/
 * takedown-e-remocao-titular.md` §4.2). ADMIN-ONLY (`requireRole 'admin'`, mesma guarda de
 * `/api/admin/config`; Curador/Usuário → 403, sem sessão → 401). Zera `source_name` em LOTE por
 * `source_name`/`source_url` — SEM ownership (inclui privadas de qualquer usuário) —, aplicando a
 * MESMA regra do self-service (`hasRemovableSourceName`) e NUNCA tocando `source_url`.
 *
 * Recebe `{ sourceName?, sourceUrl?, caseId?, apply? }`. `apply` OMITIDO/`false` = PRÉVIA (só conta
 * quantas casam / seriam removidas, sem mutar nem auditar); `apply:true` = executa (UPDATE +
 * `DSAR_FULFILLED` na MESMA transação — GAP-5). Ao menos um critério (nome OU url) é obrigatório
 * (senão 400 — nunca varre a base inteira). `caseId`, se informado, deve ser uuid (400 se não).
 * Idempotente: uma 2ª aplicação com o mesmo critério casa 0 removíveis (o nome já foi zerado).
 */
export async function POST(req: Request): Promise<Response> {
  const g = await requireRole(req, 'admin')
  if (!g.ok) return g.response

  const body = (await req.json().catch(() => ({}))) as {
    sourceName?: unknown
    sourceUrl?: unknown
    caseId?: unknown
    apply?: unknown
  }
  const sourceName = typeof body.sourceName === 'string' ? body.sourceName : null
  const sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl : null
  const caseId =
    typeof body.caseId === 'string' && body.caseId.trim() !== '' ? body.caseId.trim() : null
  const apply = body.apply === true

  // Ao menos um critério não-vazio — senão 400 (não varre tudo).
  if ((sourceName?.trim() ?? '') === '' && (sourceUrl?.trim() ?? '') === '') {
    return Response.json({ error: 'criterio_obrigatorio' }, { status: 400 })
  }
  // caseId opcional; se veio, precisa ser uuid (a coluna é uuid — evita 500 do driver).
  if (caseId !== null && !UUID_RE.test(caseId)) {
    return Response.json({ error: 'case_id_invalido' }, { status: 400 })
  }

  const result = await operatorClearSourceAttribution({
    db: getDb(),
    actorId: g.session.user.id,
    query: { sourceName, sourceUrl },
    apply,
    caseId,
  })
  return Response.json(result)
}
