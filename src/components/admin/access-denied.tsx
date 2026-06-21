'use client'

/**
 * Tela de acesso negado do Console (#63). Tom NEUTRO — negação de acesso não é Aviso de
 * restrição, então sem âmbar (ADR-0015). Dois contextos de uso (#125):
 *  - `standalone` (default): o gate do `layout.tsx` a renderiza como a página inteira → rende
 *    o `<main>` do documento (único landmark <main>).
 *  - `standalone={false}`: a negação por seção (`SectionGate`) já vive DENTRO do `<main>` do
 *    `ConsoleShell` → rende um `<section>`, pra não aninhar landmarks (HTML inválido + a11y).
 */
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'
import { Button } from '@/components/ui/button'

export function AccessDenied({ standalone = true }: { standalone?: boolean } = {}) {
  const { messages } = useLocale()
  const m = messages.admin
  const inner = (
    <>
      <h1 className="font-display text-3xl font-semibold text-fg">{m.acessoNegadoTitulo}</h1>
      <p className="max-w-prose text-muted">{m.acessoNegado}</p>
      <Button asChild variant="secondary">
        <Link href="/">{m.voltarInicio}</Link>
      </Button>
    </>
  )
  return standalone ? (
    <Container as="main" className="flex flex-1 flex-col items-start gap-4 py-12 sm:py-16">
      {inner}
    </Container>
  ) : (
    <section className="flex flex-col items-start gap-4">{inner}</section>
  )
}
