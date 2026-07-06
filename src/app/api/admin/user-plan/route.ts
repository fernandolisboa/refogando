import { eq } from 'drizzle-orm'
import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import { isPlan } from '@/domain/plan'

export const runtime = 'nodejs'

/**
 * Conceder/reverter o PLANO comercial de um usuário (Fase 2 de billing, #466) — ADMIN-ONLY
 * (`requireRole 'admin'`, mesma guarda do PUT /api/admin/roles). É a concessão MANUAL de `pro`
 * (concierge): NÃO cobra nada, NÃO liga billing — só grava `users.plan` para o usuário poder pegar
 * os tetos da tabela `pro` (que o admin configura em `/api/admin/config` `proCaps`). Enquanto o
 * billing real não está ligado, esta é a ÚNICA forma de um usuário virar `pro`.
 *
 * Corpo: `{ identifier, plan }`. `identifier` = `@handle` OU email (resolvido por coluna: começa com
 * `@` → handle; contém `@` (não no início) → email; senão → handle). `plan` ∈ PLANS (`isPlan`, mesma
 * disciplina do `isRole` em /api/admin/roles). Um único `UPDATE ... RETURNING` faz lookup + gravação
 * atômicos: 0 linhas ⇒ 404 `usuario_nao_encontrado` (não existe / handle-email errado).
 *
 * Erros por CHAVE do corpo `{error}`: `plano_invalido` (400) plano fora de PLANS; `dados_invalidos`
 * (400) identifier ausente/vazio; `usuario_nao_encontrado` (404); `erro_interno` (500, SEM stack)
 * para qualquer outro lançamento. Devolve `{ user: { name, handle, email, plan } }` — o plano
 * RESOLVIDO (pós-gravação), pra a UI confirmar o estado atual. `email` só vaza porque é admin-only
 * (mesma exposição do /api/admin/users/search).
 */
export async function POST(req: Request): Promise<Response> {
  const g = await requireRole(req, 'admin')
  if (!g.ok) return g.response

  const body = (await req.json().catch(() => ({}))) as { identifier?: unknown; plan?: unknown }

  if (typeof body.plan !== 'string' || !isPlan(body.plan)) {
    return Response.json({ error: 'plano_invalido' }, { status: 400 })
  }
  const plan = body.plan

  if (typeof body.identifier !== 'string' || body.identifier.trim() === '') {
    return Response.json({ error: 'dados_invalidos' }, { status: 400 })
  }
  const raw = body.identifier.trim()

  // Resolve a coluna de lookup: `@handle` → handle (sem o `@`); `x@y` → email; senão → handle
  // (o admin pode digitar o handle sem o `@`). Match EXATO (handle e email são únicos no schema).
  let column: typeof users.handle | typeof users.email
  let term: string
  if (raw.startsWith('@')) {
    column = users.handle
    term = raw.slice(1)
  } else if (raw.includes('@')) {
    column = users.email
    term = raw
  } else {
    column = users.handle
    term = raw
  }
  if (term === '') {
    return Response.json({ error: 'dados_invalidos' }, { status: 400 })
  }

  try {
    const [updated] = await getDb()
      .update(users)
      .set({ plan })
      .where(eq(column, term))
      .returning({
        name: users.name,
        handle: users.handle,
        email: users.email,
        plan: users.plan,
      })
    if (!updated) {
      return Response.json({ error: 'usuario_nao_encontrado' }, { status: 404 })
    }
    return Response.json({ user: updated })
  } catch {
    return Response.json({ error: 'erro_interno' }, { status: 500 })
  }
}
