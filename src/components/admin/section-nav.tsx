'use client'

/**
 * Navegação por seção do Console (#125) — afordância client das rotas aninhadas. Recebe o
 * `role` JÁ garantido (>= curador) do `layout.tsx` server-side; esconde a Governança
 * (Config, Papéis) para o Curador (AC5 — escondido, não desabilitado), igual ao antigo
 * `AdminConsole`. Marca a rota ativa com `aria-current` via `usePathname`.
 *
 * O link aqui é só atalho: cada rota REVALIDA o papel server-side no seu `page.tsx`, então
 * esconder a Governança não é a barreira — o gate é. Cores: só tokens AA-verificados da #54.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale } from '@/i18n/provider'

type Item = { href: string; label: string }

export function SectionNav({ role }: { role: 'admin' | 'curador' }) {
  const { messages } = useLocale()
  const m = messages.admin
  const pathname = usePathname()
  const isAdmin = role === 'admin'

  // Governança (admin-only) vem antes da Curadoria, espelhando a ordem dos grupos do Console.
  const governanca: Item[] = isAdmin
    ? [
        { href: '/admin/config', label: m.navConfig },
        { href: '/admin/ai', label: m.navAi },
        { href: '/admin/users', label: m.navPapeis },
      ]
    : []
  const curadoria: Item[] = [
    { href: '/admin/moderation', label: m.navModeracao },
    { href: '/admin/translations', label: m.navTraducoes },
    { href: '/admin/catalog', label: m.navCatalogo },
  ]
  const items = [...governanca, ...curadoria]

  return (
    <nav aria-label={m.navAria} className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
      {items.map((it) => {
        const active = pathname === it.href
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
    </nav>
  )
}
