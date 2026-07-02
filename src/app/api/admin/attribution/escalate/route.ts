import { requireRole } from '@/server/auth/guard'
import { getDb, getImageStore } from '@/server/deps'
import {
  operatorEscalateSource,
  type OperatorEscalateAction,
} from '@/server/recipe/operator-clear-attribution'

export const runtime = 'nodejs'

/** uuid canônico (a coluna `dsar_audit_event.case_id` é uuid — um caseId inválido estouraria 22P02). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ESCALATE_ACTIONS: readonly OperatorEscalateAction[] = ['url_unlink', 'record_deletion']

/**
 * ESCALADA além do nome (titular B) pelo operador — #397/GAP-3 (`docs/legal/
 * takedown-e-remocao-titular.md` §4.1). Rota IRMÃ de `/api/admin/attribution/clear` (#396): mesma
 * guarda, mesma forma de validação; separada para manter o `clear` (remoção-de-nome) byte-idêntico.
 * ADMIN-ONLY (`requireRole 'admin'`; Curador/Usuário → 403, sem sessão → 401).
 *
 * O MECANISMO só: a POLÍTICA de QUANDO desvincular/apagar aguarda o sign-off jurídico do #276 — a UI
 * deixa isso explícito; a rota não decide, só executa. Recebe `{ action, sourceName?, sourceUrl?,
 * caseId?, apply? }`. `action` ∈ {'url_unlink','record_deletion'} (400 se ausente/inválida). `apply`
 * OMITIDO/`false` = PRÉVIA (só escopo, sem efeito); `apply:true` = executa (desvincula/apaga +
 * `DSAR_FULFILLED` na MESMA transação — GAP-5). Ao menos um critério (nome OU url) é obrigatório (senão
 * 400 — nunca varre tudo). `caseId`, se informado, deve ser uuid. Idempotente (2ª execução casa 0).
 */
export async function POST(req: Request): Promise<Response> {
  const g = await requireRole(req, 'admin')
  if (!g.ok) return g.response

  const body = (await req.json().catch(() => ({}))) as {
    action?: unknown
    sourceName?: unknown
    sourceUrl?: unknown
    caseId?: unknown
    apply?: unknown
  }
  const action = ESCALATE_ACTIONS.find((a) => a === body.action)
  const sourceName = typeof body.sourceName === 'string' ? body.sourceName : null
  const sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl : null
  const caseId =
    typeof body.caseId === 'string' && body.caseId.trim() !== '' ? body.caseId.trim() : null
  const apply = body.apply === true

  // Ação conhecida obrigatória (senão não sabemos desvincular vs. apagar).
  if (!action) {
    return Response.json({ error: 'acao_invalida' }, { status: 400 })
  }
  // Ao menos um critério não-vazio — senão 400 (não varre tudo).
  if ((sourceName?.trim() ?? '') === '' && (sourceUrl?.trim() ?? '') === '') {
    return Response.json({ error: 'criterio_obrigatorio' }, { status: 400 })
  }
  // caseId opcional; se veio, precisa ser uuid (a coluna é uuid — evita 500 do driver).
  if (caseId !== null && !UUID_RE.test(caseId)) {
    return Response.json({ error: 'case_id_invalido' }, { status: 400 })
  }

  const result = await operatorEscalateSource({
    db: getDb(),
    actorId: g.session.user.id,
    query: { sourceName, sourceUrl },
    action,
    apply,
    caseId,
    // Só o apply de record_deletion precisa do store (limpa blobs órfãos #146).
    store: action === 'record_deletion' && apply ? getImageStore() : null,
  })
  return Response.json(result)
}
