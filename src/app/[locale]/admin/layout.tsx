/**
 * Layout do Console (#125) — aplica o gate de acesso UMA ÚNICA VEZ (porta única do /admin)
 * e desenha a chrome compartilhada: cabeçalho + navegação por seção. As seções viram rotas
 * aninhadas bookmarkáveis (`/admin/ia`, `/admin/users`, `/admin/moderation`,
 * `/admin/translations`, `/admin/catalog`); cada `page.tsx` REVALIDA o papel server-side
 * com o seu mínimo (Governança='admin', Curadoria='curador') — o gate é por rota, não só
 * link escondido.
 *
 * Server Component fino: resolve a sessão via `gateSection('curador')` (que delega ao
 * veredito PURO fail-closed `decideSectionAccess`, reusando `decideRole`/`isRole` do domínio
 * — o gate NÃO é reimplementado, lição da #51). `redirect` → login; `denied` → AccessDenied.
 *
 * Owns o ÚNICO landmark <main> do documento (via `<Container as="main">`): as seções rendem
 * só o próprio `<section>`/`<h2>`, igual ao antigo `AdminConsole`. A matriz fail-closed mora
 * em `test/server/admin-section-access.test.ts` + `test/integration/admin-routes-gate.test.ts`.
 */
import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { gateSection } from './gate'
import { ConsoleShell } from '@/components/admin/console-shell'
import { AccessDenied } from '@/components/admin/access-denied'

export const runtime = 'nodejs' // Better Auth + postgres-js exigem Node, não Edge.

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const decision = await gateSection('curador')

  if (decision === 'redirect') redirect('/sign-in')
  if (decision === 'denied') return <AccessDenied />

  return <ConsoleShell role={decision.role}>{children}</ConsoleShell>
}
