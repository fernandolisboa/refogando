'use client'
/**
 * Toggle manual de tema claro/escuro (ADR-0018), no header ao lado dos controles da chrome.
 * Espelha o padrão do locale: o servidor lê o cookie `theme` e emite a classe no `<html>`
 * (SSR sem flash, em layout.tsx); aqui o client grava o cookie e alterna a classe no
 * `documentElement`. Usa a primitiva `<Button variant="ghost" size="icon">` (ADR-0018).
 *
 * `initialTheme` vem do SERVIDOR (cookie), threadado de layout.tsx → SiteHeader. `null` =
 * usuário nunca escolheu → o tema efetivo segue o SO. O tema do SO é lido por
 * `useSyncExternalStore` (snapshot de servidor estável = 'light', reconciliado no client sem
 * `setState` em efeito), e o estado de presentation real já vem do CSS (@media), então o
 * ícone reconcilia sem flash de cor na página.
 */
import { useState, useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/provider'
import { THEME_COOKIE, type Theme } from '@/lib/theme'

function subscribeOsTheme(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
function getOsTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
function getOsThemeServer(): Theme {
  return 'light'
}

export function ThemeToggle({ initialTheme }: { initialTheme: Theme | null }) {
  const { messages } = useLocale()
  // Escolha EXPLÍCITA do usuário: cookie do servidor, depois os cliques. `null` = segue o SO.
  const [explicit, setExplicit] = useState<Theme | null>(initialTheme)
  // Preferência do SO (sem `setState` em efeito; hydration-safe via snapshot de servidor).
  const osTheme = useSyncExternalStore(subscribeOsTheme, getOsTheme, getOsThemeServer)
  const effective: Theme = explicit ?? osTheme

  function toggle() {
    const next: Theme = effective === 'dark' ? 'light' : 'dark'
    setExplicit(next)
    // Persiste a preferência (1 ano; Path=/; SameSite=Lax — só apresentação, igual ao locale)
    // e alterna a classe no <html>, que o CSS usa para sobrescrever o @media do SO.
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    const root = document.documentElement
    root.classList.add(next)
    root.classList.remove(next === 'dark' ? 'light' : 'dark')
  }

  // O rótulo nomeia o DESTINO da ação (a11y): se vamos pro escuro, mostramos a lua.
  const goingDark = effective !== 'dark'
  const label = goingDark ? messages.theme.dark : messages.theme.light

  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      {goingDark ? (
        <Moon size={17} strokeWidth={1.5} aria-hidden="true" />
      ) : (
        <Sun size={17} strokeWidth={1.5} aria-hidden="true" />
      )}
    </Button>
  )
}
