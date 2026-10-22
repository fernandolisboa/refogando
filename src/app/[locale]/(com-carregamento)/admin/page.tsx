/**
 * Índice do Console (#125). Decisão: `/admin` NÃO tem conteúdo próprio — REDIRECIONA para a
 * primeira seção do papel (mais simples e limpo que uma landing vazia que duplicaria a nav).
 * Admin entra em Usuários (`/admin/users`, 1º link da barra lateral, ADR-0049); Curador, que só vê
 * a Curadoria, entra na Moderação (`/admin/moderation`).
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

  // Admin abre em Usuários; Curador (só Curadoria) abre na Moderação.
  redirect(decision.role === 'admin' ? '/admin/users' : '/admin/moderation')
}
