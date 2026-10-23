import { isAccountClosureReason } from '@/domain/account-closure'
import { requireFreshRole } from '@/server/auth/guard'
import { closeAccountByAdmin } from '@/server/admin/account-closure'
import { getDb, getImageStore, getMailer } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { crossSiteForbidden, isCrossSiteRequest } from '@/server/http/same-origin'

/**
 * POST /api/admin/users/[id]/erasure — o admin ENCERRA a conta de outra pessoa (#606; ADR-0051 P1 e P3; Termos itens
 * 2 e 8): conta de alguém com menos de 16 anos ou violação grave dos Termos. Mesmo núcleo da eliminação self-service
 * (`eraseAccount`): o privado sai agora, o público fica anonimizado (ou sai, no menor de 16, com
 * `removePublicContent`), e a decisão vai para `account_closure`, sem dado pessoal. Ver `closeAccountByAdmin`.
 *
 * Guardas, na ordem: mesma origem (`Sec-Fetch-Site`, 403 `origem_nao_permitida`, como `/api/me/erasure`); admin com
 * sessão RECENTE (`requireFreshRole`: 401 sem sessão, 403 `papel_insuficiente`, 403 `reautenticar` com sessão de
 * mais de 24 h); id que não é uuid ⇒ 404.
 *
 * Corpo: `{ reason, removePublicContent?, notify?, confirmHandle }`. `reason` ∈ `ACCOUNT_CLOSURE_REASONS`;
 * `removePublicContent` (padrão false) só no `menor_16`; `notify` (padrão true) só vale na violação; `confirmHandle`
 * é o @ atual da conta, digitado (confirmação de uma ação que não se desfaz).
 *
 * Erros `{ error }`: 400 `dados_invalidos` (corpo fora da forma), `conteudo_publico_so_menor_16`, `conta_propria`,
 * `confirmacao_invalida`; 404 `not_found`; 409 `conta_inativa` (já desativada ou eliminada), `alvo_admin` (rebaixar
 * antes). 200 `{ ok, removedPublicContent, notifiedByEmail, emailSent }`. Tudo `no-store`.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.
// Folga para a conta com muitas Receitas: as transações por receita, a eliminação e os blobs depois do commit.
export const maxDuration = 60

const NO_STORE = { 'cache-control': 'no-store' }

function fail(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: NO_STORE })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (isCrossSiteRequest(request)) return crossSiteForbidden()
  const g = await requireFreshRole(request, 'admin')
  if (!g.ok) return g.response

  const { id } = await params
  if (!isUuid(id)) return fail('not_found', 404)

  const body = (await request.json().catch(() => null)) as {
    reason?: unknown
    removePublicContent?: unknown
    notify?: unknown
    confirmHandle?: unknown
  } | null
  if (
    body == null ||
    typeof body !== 'object' ||
    !isAccountClosureReason(body.reason) ||
    (body.removePublicContent !== undefined && typeof body.removePublicContent !== 'boolean') ||
    (body.notify !== undefined && typeof body.notify !== 'boolean')
  ) {
    return fail('dados_invalidos', 400)
  }
  if (typeof body.confirmHandle !== 'string') return fail('confirmacao_invalida', 400)

  const res = await closeAccountByAdmin(getDb(), getImageStore(), getMailer(), {
    adminId: g.session.user.id,
    userId: id,
    reason: body.reason,
    removePublicContent: body.removePublicContent === true,
    notify: body.notify !== false,
    confirmHandle: body.confirmHandle,
  })
  switch (res.kind) {
    case 'closed':
      return Response.json(
        {
          ok: true,
          removedPublicContent: res.removedPublicContent,
          notifiedByEmail: res.notifiedByEmail,
          emailSent: res.emailSent,
        },
        { status: 200, headers: NO_STORE },
      )
    case 'public_content_not_allowed':
      return fail('conteudo_publico_so_menor_16', 400)
    case 'own_account':
      return fail('conta_propria', 400)
    case 'handle_mismatch':
      return fail('confirmacao_invalida', 400)
    case 'not_found':
      return fail('not_found', 404)
    case 'inactive':
      return fail('conta_inativa', 409)
    case 'target_admin':
      return fail('alvo_admin', 409)
  }
}
