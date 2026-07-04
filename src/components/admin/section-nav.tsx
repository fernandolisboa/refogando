'use client'

/**
 * Navegação por seção do Console (#125) — afordância client das rotas aninhadas. Recebe o
 * `role` JÁ garantido (>= curador) do `layout.tsx` server-side; esconde a Governança
 * (Config, Papéis) para o Curador (AC5 — escondido, não desabilitado), igual ao antigo
 * `AdminConsole`. Marca a rota ativa com `aria-current` via `usePathname`.
 *
 * #268: os links agora vêm AGRUPADOS sob os rótulos `grupoPlataforma`/`grupoCuradoria` (cada grupo
 * é um `role="group"` rotulado por `aria-labelledby`), pra um Admin leigo entender Governança vs
 * Curadoria. O grupo Plataforma some pro Curador (sem itens → não renderiza). A tira segue ROLÁVEL
 * na horizontal (overflow-x-auto + whitespace-nowrap, SEM flex-wrap — #162).
 *
 * O link aqui é só atalho: cada rota REVALIDA o papel server-side no seu `page.tsx`, então
 * esconder a Governança não é a barreira — o gate é. Cores: só tokens AA-verificados da #54.
 */
import { Fragment } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { splitLocalePrefix } from '@/i18n/locale-path'

type Item = { href: string; label: string }

export function SectionNav({ role }: { role: 'admin' | 'curador' }) {
  const { messages } = useLocale()
  const m = messages.admin
  // `usePathname()` vem PREFIXADO pelo locale (`/pt-BR/admin/ia`), mas os hrefs abaixo são NUS
  // (`/admin/ia`) — tiramos o prefixo (`splitLocalePrefix → rest`) ANTES de comparar, senão o
  // `aria-current`/sublinhado ativo nunca dispara. Mesmo fix do site-header (#277). Null-safe fora
  // do contexto de router (seam jsdom) via `?? '/'`.
  const rest = splitLocalePrefix(usePathname() ?? '/').rest
  const isAdmin = role === 'admin'

  // Governança (admin-only) vem antes da Curadoria, espelhando a ordem dos grupos do Console.
  const governanca: Item[] = isAdmin
    ? [
        { href: '/admin/ia', label: m.navIa },
        { href: '/admin/descoberta', label: m.navDescoberta },
        { href: '/admin/comparador', label: m.navComparador },
        { href: '/admin/vocabulario', label: m.navVocabulario },
        { href: '/admin/users', label: m.navPapeis },
      ]
    : []
  const curadoria: Item[] = [
    { href: '/admin/moderation', label: m.navModeracao },
    { href: '/admin/translations', label: m.navTraducoes },
    { href: '/admin/catalog', label: m.navCatalogo },
  ]
  // Grupos rotulados (#268). O grupo sem itens (Plataforma p/ Curador) é descartado — não renderiza
  // rótulo órfão. A ordem (Plataforma → Curadoria) espelha a hierarquia do Console.
  const groups = [
    { key: 'plataforma', label: m.grupoPlataforma, items: governanca },
    { key: 'curadoria', label: m.grupoCuradoria, items: curadoria },
  ].filter((g) => g.items.length > 0)

  return (
    <nav
      aria-label={m.navAria}
      className="flex gap-x-6 gap-y-2 overflow-x-auto whitespace-nowrap pb-2 text-sm font-medium"
    >
      {groups.map((g, gi) => {
        const labelId = `section-group-${g.key}`
        return (
          <Fragment key={g.key}>
            {/* Divisor entre grupos (#268): marca a fronteira Governança/Curadoria pra quem rola a
                tira na horizontal. aria-hidden — a separação semântica já vem do role=group. */}
            {gi > 0 && <span aria-hidden="true" className="h-4 w-px shrink-0 self-center bg-border" />}
            <div
              role="group"
              aria-labelledby={labelId}
              className="flex shrink-0 items-center gap-x-4"
            >
              <span
                id={labelId}
                className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {g.label}
              </span>
              {g.items.map((it) => {
                const active = rest === it.href
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    aria-current={active ? 'page' : undefined}
                    className={
                      active
                        ? 'border-b-2 border-brand pb-0.5 text-fg'
                        : 'border-b-2 border-transparent pb-0.5 text-muted transition-colors hover:text-fg'
                    }
                  >
                    {it.label}
                  </Link>
                )
              })}
            </div>
          </Fragment>
        )
      })}
    </nav>
  )
}
