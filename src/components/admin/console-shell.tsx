'use client'

/**
 * Chrome compartilhada das rotas aninhadas do Console (#125). Recebe o `role` JÁ garantido
 * (>= curador) do `layout.tsx` server-side e desenha: cabeçalho (titulo/subtitulo) + a
 * navegação por seção (`SectionNav`, role-aware) + a seção ativa (`children`).
 *
 * Client porque lê `useLocale()` (titulo/subtitulo) e `SectionNav` lê `usePathname()`. Rende
 * o ÚNICO landmark <main> do documento via `<Container as="main">` — as `page.tsx` filhas
 * montam só o componente de seção (que rende seu próprio `<section>`/`<h2>`, sem outro <main>).
 * Cores: só tokens AA-verificados da #54.
 */
import type { ReactNode } from 'react'
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'
import { SectionNav } from '@/components/admin/section-nav'

export function ConsoleShell({
  role,
  children,
}: {
  role: 'admin' | 'curador'
  children: ReactNode
}) {
  const { messages } = useLocale()
  const m = messages.admin

  return (
    <Container as="main" className="flex flex-1 flex-col gap-8 py-8 sm:py-12">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold text-fg">{m.titulo}</h1>
        <p className="text-muted">{m.subtitulo}</p>
      </header>

      <SectionNav role={role} />

      {/* A seção ativa (rota filha). Respiro entre a nav e o conteúdo via gap do main. */}
      <div className="flex flex-col gap-8 border-t border-border pt-8">{children}</div>
    </Container>
  )
}
