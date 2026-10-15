/**
 * Índice do Console (#125). Decisão: `/admin` NÃO tem conteúdo próprio — REDIRECIONA para a
 * primeira seção do papel (mais simples e limpo que uma landing vazia que duplicaria a nav).
 * Admin entra na Governança (`/admin/ia`); Curador, que não vê Governança, entra na
 * Curadoria (`/admin/moderation`).
 *
 * O `layout.tsx` já aplicou o gate (curador+) antes desta page rodar. Resolvemos o papel de
 * novo (via `gateSection`) só para escolher o destino — e mantemos o redirect ao login para
 * anon/papel insuficiente, deixando a página auto-suficiente mesmo fora do layout.
 */
import { redirect } from 'next/navigation'
import { gateSection } from './gate'

export const runtime = 'nodejs'

export default async function AdminIndexPage() {
  const decision = await gateSection('curador')

  if (decision === 'redirect') redirect('/sign-in')
  if (decision === 'denied') redirect('/sign-in')

  // Admin abre na Governança; Curador (sem Governança) abre na Curadoria.
  redirect(decision.role === 'admin' ? '/admin/ia' : '/admin/moderation')
}
