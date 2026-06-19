'use client'
/**
 * Footer do shell (issue #54). Client component pra acompanhar o locale (app.name /
 * app.tagline + o seletor de idioma) na troca em runtime (#4.AC1). Sem chamadas de
 * dados (#4.AC4). Fica no rodapé pelo wrapper flex-1 do layout (não precisa de mt-auto).
 * O seletor de locale mora AQUI (movido do header) — descoberta secundária, longe da nav.
 */
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'
import { LocaleSwitcher } from '@/i18n/locale-switcher'

export function SiteFooter() {
  const { messages } = useLocale()
  return (
    <footer className="border-t border-border">
      <Container className="flex flex-col items-start gap-4 py-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="font-display text-lg font-semibold text-brand-ink">
            {messages.app.name}
          </span>
          <span className="text-sm text-muted">{messages.app.tagline}</span>
        </div>
        <LocaleSwitcher />
      </Container>
    </footer>
  )
}
