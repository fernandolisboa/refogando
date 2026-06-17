'use client'
/**
 * Slot de estado de autenticação no header (issue #54) — PLACEHOLDER.
 *
 * Modela o lugar do Visitante vs Usuário na chrome, mas NÃO fala com a auth de verdade
 * (sem sessão, sem chamada a endpoint) — isso é a fatia #55. Renderiza a afordância de
 * "Entrar" (messages.nav.signIn). Preserva o isolamento de #4.AC4: a chrome não chama
 * nenhum endpoint de Receita nem o seam logado (/api/me/locale).
 */
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'

export function AuthSlot() {
  const { messages } = useLocale()
  return (
    <Link
      href="/sign-in"
      className="inline-flex items-center rounded-md bg-brand-strong px-3.5 py-1.5 text-sm font-medium text-on-brand shadow-sm transition-colors duration-150 ease-out hover:opacity-90"
    >
      {messages.nav.signIn}
    </Link>
  )
}
