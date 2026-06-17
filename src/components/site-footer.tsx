'use client'
/**
 * Footer do shell (issue #54). Client component pra acompanhar o locale (app.name /
 * app.tagline) na troca em runtime (#4.AC1). Sem chamadas de dados (#4.AC4).
 */
import { useLocale } from '@/i18n/provider'

export function SiteFooter() {
  const { messages } = useLocale()
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex max-w-page flex-col gap-1 px-4 py-8 sm:px-6">
        <span className="font-display text-lg font-semibold text-brand-strong">
          {messages.app.name}
        </span>
        <span className="text-sm text-muted">{messages.app.tagline}</span>
      </div>
    </footer>
  )
}
