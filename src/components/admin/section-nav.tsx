'use client'

/**
 * Navegação por seção do Console (#125) — a barra lateral (desktop) e o conteúdo da gaveta de seções
 * (celular). Recebe o `role` JÁ garantido (>= curador) do `layout.tsx` server-side; os grupos Pessoas e
 * Plataforma somem para o Curador (AC5 — escondido, não desabilitado). Marca a rota ativa com
 * `aria-current` via `usePathname`.
 *
 * Os links vêm AGRUPADOS (#268), cada grupo um `role="group"` rotulado por `aria-labelledby`; a estrutura
 * (rotas, rótulos, ícones) mora em `console-sections.ts`. `onNavigate` deixa a gaveta do celular fechar ao
 * escolher uma seção. `idPrefix` separa os ids dos rótulos quando as duas instâncias coexistem no DOM.
 *
 * O link aqui é só atalho: cada rota REVALIDA o papel server-side no seu `page.tsx`, então esconder um grupo
 * não é a barreira — o gate é. Cores: só tokens AA-verificados da #54.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { splitLocalePrefix } from '@/i18n/locale-path'
import { cn } from '@/lib/utils'
import { findConsoleSection, groupsForRole } from '@/components/admin/console-sections'

export function SectionNav({
  role,
  onNavigate,
  idPrefix = 'section-group',
}: {
  role: 'admin' | 'curador'
  onNavigate?: () => void
  idPrefix?: string
}) {
  const { messages } = useLocale()
  const m = messages.admin
  // `usePathname()` vem PREFIXADO pelo locale (`/pt-BR/admin/ia`), mas os hrefs são NUS (`/admin/ia`) —
  // tiramos o prefixo antes de comparar (mesmo fix do site-header, #277). Null-safe no seam jsdom.
  const rest = splitLocalePrefix(usePathname() ?? '/').rest
  const activeHref = findConsoleSection(rest)?.section.href ?? null

  return (
    <nav aria-label={m.navAria} className="flex flex-col gap-6 text-sm">
      {groupsForRole(role).map((g) => {
        const labelId = `${idPrefix}-${g.key}`
        return (
          <div key={g.key} role="group" aria-labelledby={labelId} className="flex flex-col gap-0.5">
            <span
              id={labelId}
              className="px-3 pb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase"
            >
              {m[g.label]}
            </span>
            {g.sections.map((s) => {
              const active = s.href === activeHref
              const Icon = s.icon
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-10 items-center gap-3 rounded-md px-3 font-medium transition-colors',
                    active ? 'bg-brand/12 text-fg' : 'text-muted hover:bg-surface hover:text-fg',
                  )}
                >
                  <Icon
                    aria-hidden="true"
                    className={cn('size-[18px] shrink-0', active ? 'text-brand-ink' : 'text-muted')}
                  />
                  {m[s.label]}
                </Link>
              )
            })}
          </div>
        )
      })}
    </nav>
  )
}
