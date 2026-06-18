/**
 * Console de administração (#63) — Server Component fino. Resolve a sessão server-side e
 * despacha pelo veredito PURO `decideAdminAccess` (que reusa `decideRole`/`isRole` do
 * domínio — o gate NÃO é reimplementado aqui).
 *
 * Padrão NOVO de resolução de sessão em Server Component: chama `getAuth().api.getSession`
 * com os `headers()` do request. Não há precedente no codebase (`recipes/[id]/page.tsx`
 * resolve por self-fetch encaminhando o cookie); ler a sessão num Server Component NÃO viola
 * ADR-0010 — não é Server Action nem regra de domínio, é só leitura de sessão. As SEÇÕES
 * (Client Components) consomem as rotas por `fetch` e cada rota reforça o gate server-side.
 *
 * O gating mora no helper puro reusável e testável (`test/server/admin-access.test.ts`, a
 * matriz fail-closed que o jsdom não alcança), não aqui. `AdminConsole`/`AccessDenied`
 * rendem cada um o próprio `<Container as="main">` — esta page não envolve em Container.
 */
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAuth } from '@/lib/auth'
import { decideAdminAccess } from '@/server/auth/admin-access'
import { AdminConsole } from '@/components/admin/admin-console'
import { AccessDenied } from '@/components/admin/access-denied'

export const runtime = 'nodejs' // Better Auth + postgres-js exigem Node, não Edge.

export default async function AdminPage() {
  const session = await getAuth().api.getSession({ headers: await headers() })
  const decision = decideAdminAccess(session?.user)

  if (decision === 'redirect') redirect('/sign-in')
  if (decision === 'denied') return <AccessDenied />

  return <AdminConsole role={decision.role} />
}
