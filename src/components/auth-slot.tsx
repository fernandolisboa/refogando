'use client'
/**
 * Slot de estado de autenticação no header (issue #54) — PLACEHOLDER.
 *
 * Modela o lugar do Visitante vs Usuário na chrome, mas NÃO fala com a auth de verdade
 * (sem sessão, sem chamada a endpoint) — isso é a fatia #55. Renderiza a afordância de
 * "Entrar" (messages.nav.signIn) com o estilo canônico de botão. Preserva o isolamento
 * de #4.AC4: a chrome não chama endpoint de Receita nem o seam logado (/api/me/locale).
 */
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { btnPrimarySm } from '@/components/button'

export function AuthSlot() {
  const { messages } = useLocale()
  return (
    <Link href="/sign-in" className={btnPrimarySm}>
      {messages.nav.signIn}
    </Link>
  )
}
