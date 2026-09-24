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
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'
import { ThemeToggle } from '@/components/theme-toggle'
import { LocaleSwitcher } from '@/i18n/locale-switcher'
import { type Theme } from '@/lib/theme'
import { PLATFORM_DISPLAY, type SocialLink } from '@/domain/social-links-config'

export function SiteFooter({
  initialTheme = null,
  socialLinks = [],
}: {
  initialTheme?: Theme | null
  // #451: links de redes sociais do site, JÁ filtrados por `enabled` no servidor (layout.tsx).
  socialLinks?: SocialLink[]
}) {
  const { messages } = useLocale()
  return (
    <footer className="border-t border-border">
      <Container className="flex flex-col items-start gap-4 py-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="font-display text-lg font-semibold text-brand-ink">
            {messages.app.name}
          </span>
          <span className="text-sm text-muted">{messages.app.tagline}</span>
          {/* Links legais (parte de #276): Política de Privacidade + Seus Direitos. Rótulos i18n. Um
              <div> (não <nav>) para não criar um segundo landmark de navegação além do header. */}
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <Link href="/privacidade" className="hover:text-fg hover:underline">
              {messages.privacidade.titulo}
            </Link>
            <Link href="/seus-direitos" className="hover:text-fg hover:underline">
              {messages.seusDireitos.titulo}
            </Link>
          </div>
          {/* #451: links de redes sociais (só renderiza quando há algum ligado). <div>, não <nav> —
              mesma decisão dos links legais acima (não criar 2º landmark de navegação). Links externos
              endurecidos (rel=noopener noreferrer, target=_blank); SEM nofollow (são as redes PRÓPRIAS
              do site). Texto = label ou o nome de marca (não traduzido); só o sufixo do aria-label é i18n. */}
          {socialLinks.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              {socialLinks.map((l) => {
                const nome = l.label ?? PLATFORM_DISPLAY[l.platform]
                return (
                  <a
                    key={l.platform}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${nome} — ${messages.footer.abreEmNovaAba}`}
                    className="hover:text-fg hover:underline"
                  >
                    {nome}
                  </a>
                )
              })}
            </div>
          )}
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
