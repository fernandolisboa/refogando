import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAuth } from '@/lib/auth'
import { decideSectionAccess, type SectionAccess } from '@/server/auth/admin-access'
import { AccessDenied } from '@/components/admin/access-denied'

/**
 * Gate server-side das rotas aninhadas do Console (#125). Resolve a sessão do request
 * (mesmo padrão do antigo `admin/page.tsx`: `getSession` com os `headers()` do request) e
 * delega ao veredito PURO `decideSectionAccess` — NÃO reimplementa a regra (fail-closed #51).
 *
 * O `layout.tsx` chama com `min='curador'` (porta única do Console). Cada `page.tsx` de
 * seção chama de novo com o SEU mínimo ('admin' para Governança, 'curador' para Curadoria):
 * acesso direto a `/admin/config` por um Curador é barrado AQUI, não só por link escondido.
 *
 * Ler a sessão num Server Component é só leitura (não viola ADR-0010 — não é Server Action
 * nem regra de domínio). As rotas de API que as seções consomem por fetch reforçam o gate.
 */
export async function gateSection(min: 'curador' | 'admin'): Promise<SectionAccess> {
  const session = await getAuth().api.getSession({ headers: await headers() })
  return decideSectionAccess(session?.user, min)
}

/**
 * Despacho compartilhado das `page.tsx` de seção (#125): gateia com o mínimo da seção e
 * devolve a seção (`children`) só se autorizado. `redirect` (anon/desativado) → login;
 * `denied` (papel insuficiente, ex.: Curador em rota admin-only) → `AccessDenied`. As cinco
 * páginas filhas ficam triviais e idênticas no formato — só variam (min, componente).
 */
export async function SectionGate({
  min,
  children,
}: {
  min: 'curador' | 'admin'
  children: ReactNode
}): Promise<ReactNode> {
  const decision = await gateSection(min)
  if (decision === 'redirect') redirect('/sign-in')
  if (decision === 'denied') return <AccessDenied standalone={false} />
  return children
}
