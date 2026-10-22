'use client'

/**
 * Chrome compartilhada das rotas aninhadas do Console (#125). Recebe o `role` JÁ garantido (>= curador) do
 * `layout.tsx` server-side e desenha:
 *  - desktop (lg+): barra lateral fixa com o título do Console, o papel e a `SectionNav` agrupada;
 *  - celular/tablet: um botão "Console · <seção> ▾" que abre a mesma `SectionNav` numa gaveta de baixo;
 *  - o cabeçalho da seção ativa (grupo, título e descrição, de `console-sections.ts`) e o conteúdo.
 *
 * Os `<section>` de primeiro nível das páginas viram CARDS pela classe `admin-panels` (globals.css): cada
 * componente de seção continua rendendo só o próprio `<section>`/`<h2>`, sem wrapper novo por página.
 *
 * Rende o ÚNICO landmark <main> do documento; as `page.tsx` filhas montam só o componente de seção.
 */
import { useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { useLocale } from '@/i18n/provider'
import { splitLocalePrefix } from '@/i18n/locale-path'
import { SectionNav } from '@/components/admin/section-nav'
import { findConsoleSection } from '@/components/admin/console-sections'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

export function ConsoleShell({
  role,
  children,
}: {
  role: 'admin' | 'curador'
  children: ReactNode
}) {
  const { messages } = useLocale()
  const m = messages.admin
  const [menuOpen, setMenuOpen] = useState(false)
  const current = findConsoleSection(splitLocalePrefix(usePathname() ?? '/').rest)
  const roleLabel = role === 'admin' ? m.papelAdmin : m.papelCurador

  return (
    <div className="mx-auto flex w-full max-w-wide flex-1">
      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r border-border px-4 py-8 lg:flex">
        <div className="flex items-start justify-between gap-2 px-3">
          <div className="flex flex-col">
            <span className="font-display text-xl font-semibold text-fg">{m.titulo}</span>
            <span className="text-xs text-muted">{m.subtitulo}</span>
          </div>
          <span className="mt-1 rounded-full bg-brand/12 px-2 py-0.5 text-xs font-semibold text-brand-ink">
            {roleLabel}
          </span>
        </div>
        <SectionNav role={role} />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger
            aria-label={m.abrirSecoes}
            className="flex min-h-11 items-center gap-3 rounded-md border border-border bg-surface px-3 text-left text-sm lg:hidden"
          >
            <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              {m.titulo}
            </span>
            <span className="font-semibold text-fg">{current ? m[current.section.label] : null}</span>
            <ChevronDown aria-hidden="true" className="ml-auto size-4 text-muted" />
          </SheetTrigger>
          <SheetContent
            side="bottom"
            closeLabel={m.usuariosFechar}
            className="max-h-[85vh] gap-5 overflow-y-auto rounded-t-xl bg-surface"
          >
            <SheetHeader>
              <SheetTitle className="text-fg">{m.titulo}</SheetTitle>
              <SheetDescription className="sr-only">{m.subtitulo}</SheetDescription>
            </SheetHeader>
            <SectionNav role={role} idPrefix="section-group-menu" onNavigate={() => setMenuOpen(false)} />
          </SheetContent>
        </Sheet>

        {current && (
          <header className="flex flex-col gap-1.5">
            <p className="text-xs text-muted">
              {m.titulo} · {m[current.group.label]}
            </p>
            <h1 className="font-display text-3xl font-semibold text-fg">{m[current.section.label]}</h1>
            <p className="max-w-reading text-muted">{m[current.section.description]}</p>
          </header>
        )}

        <div className="admin-panels flex flex-col gap-6">{children}</div>
      </main>
    </div>
  )
}
