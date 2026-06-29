'use client'
/**
 * Footer do shell (issue #54). Client component pra acompanhar o locale (app.name /
 * app.tagline) na troca em runtime (#4.AC1). Sem chamadas de dados (#4.AC4). Fica no
 * rodapé pelo wrapper flex-1 do layout (não precisa de mt-auto).
 * O seletor de IDIOMA (#162) e o ThemeToggle vivem AQUI, lado a lado — o header fica enxuto
 * com [wordmark, nav, conta]. Trocar idioma segue idêntico (cookie + `<html lang>` via
 * `setLocale`, em i18n/provider). `initialTheme` é threadado do servidor (cookie `theme`,
 * layout.tsx).
 */
import { useLocale } from '@/i18n/provider'
import { BrandWordmark } from '@/components/brand-wordmark'
import { Container } from '@/components/container'
import { ThemeToggle } from '@/components/theme-toggle'
import { LocaleSwitcher } from '@/i18n/locale-switcher'
import { type Theme } from '@/lib/theme'

export function SiteFooter({ initialTheme = null }: { initialTheme?: Theme | null }) {
  const { messages } = useLocale()
  return (
    <footer className="border-t border-border">
      <Container className="flex flex-col items-start gap-4 py-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          {/* Wordmark "steam-R" (#270), menor que no header. `decorative`: a marca do rodapé é
              repetição (o site já é nomeado pelo link do header) → fora da árvore de a11y. */}
          <BrandWordmark name={messages.app.name} decorative className="h-8 text-fg" />
          <span className="text-sm text-muted">{messages.app.tagline}</span>
        </div>
        {/* Controles de apresentação da chrome (#162): idioma + tema, lado a lado. */}
        <div className="flex items-center gap-3">
          <LocaleSwitcher />
          <ThemeToggle initialTheme={initialTheme} />
        </div>
      </Container>
    </footer>
  )
}
