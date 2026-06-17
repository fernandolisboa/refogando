'use client'
/**
 * Footer do shell (issue #54). Client component pra acompanhar o locale (app.name /
 * app.tagline) na troca em runtime (#4.AC1). Sem chamadas de dados (#4.AC4). Fica no
 * rodapé pelo wrapper flex-1 do layout (não precisa de mt-auto).
 */
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'

export function SiteFooter() {
  const { messages } = useLocale()
  return (
    <footer className="border-t border-border">
      <Container className="flex flex-col gap-1 py-8">
        <span className="font-display text-lg font-semibold text-brand-ink">
          {messages.app.name}
        </span>
        <span className="text-sm text-muted">{messages.app.tagline}</span>
      </Container>
    </footer>
  )
}
