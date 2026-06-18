'use client'

/**
 * Tela de acesso negado do Console (#63). O `page.tsx` a renderiza quando o veredito de
 * `decideAdminAccess` é `denied` (autenticado, papel insuficiente). Tom NEUTRO — negação de
 * acesso não é Aviso de restrição, então sem âmbar (ADR-0015). Rende seu próprio
 * `<Container as="main">` (um único landmark <main> por documento).
 */
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'
import { btnSecondary } from '@/components/button'

export function AccessDenied() {
  const { messages } = useLocale()
  const m = messages.admin
  return (
    <Container as="main" className="flex flex-1 flex-col items-start gap-4 py-12 sm:py-16">
      <h1 className="font-display text-3xl font-semibold text-fg">{m.acessoNegadoTitulo}</h1>
      <p className="max-w-prose text-muted">{m.acessoNegado}</p>
      <Link href="/" className={btnSecondary}>
        {m.voltarInicio}
      </Link>
    </Container>
  )
}
