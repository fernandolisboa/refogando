'use client'
/**
 * Toggle manual de tema claro/escuro (ADR-0018), no footer ao lado do seletor de idioma.
 * A classe do `<html>` é a fonte da verdade no client: o servidor emite `DEFAULT_THEME_CLASS` e o
 * script pré-pintura do `<head>` (`THEME_INIT_SCRIPT`, layout.tsx) troca para a do cookie `theme`
 * antes da primeira pintura. Aqui o client grava o cookie e alterna a classe no `documentElement`.
 * Usa a primitiva `<Button variant="ghost" size="icon">` (ADR-0018).
 *
 * Sem prop vinda do servidor (o layout não lê mais o cookie, achado A da auditoria de performance):
 * o tema é LIDO DO `<html>` por `useSyncExternalStore`. O snapshot de servidor é o default do SSR,
 * então a hidratação casa com o HTML; logo depois o React relê a classe que o script aplicou. O
 * `MutationObserver` mantém o rótulo em dia com qualquer troca de classe.
 *
 * O ÍCONE é escolhido por CSS (`dark:` = `.dark` no `<html>`), não pelo estado: assim ele já sai certo
 * na primeira pintura, antes da hidratação, para quem guardou 'dark' (o estado só fica certo depois).
 */
import { useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/provider'
import { DEFAULT_THEME_CLASS, THEME_COOKIE, type Theme } from '@/lib/theme'

function subscribeHtmlTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}
// Mesma regra de `resolveThemeClass`: só `.dark` é escuro; qualquer outra coisa é claro.
function getHtmlTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}
function getHtmlThemeServer(): Theme {
  return DEFAULT_THEME_CLASS
}

export function ThemeToggle() {
  const { messages } = useLocale()
  const theme = useSyncExternalStore(subscribeHtmlTheme, getHtmlTheme, getHtmlThemeServer)

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    // Persiste a preferência (1 ano; Path=/; SameSite=Lax — só apresentação, igual ao locale)
    // e alterna a classe no <html>, que o CSS usa para sobrescrever o @media do SO.
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    const root = document.documentElement
    root.classList.add(next)
    root.classList.remove(next === 'dark' ? 'light' : 'dark')
  }

  // O rótulo nomeia o DESTINO da ação (a11y): se vamos pro escuro, mostramos a lua.
  const goingDark = theme !== 'dark'
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
      {/* Lua no claro (vai pro escuro), sol no escuro (vai pro claro). */}
      <Moon size={17} strokeWidth={1.5} aria-hidden="true" className="dark:hidden" />
      <Sun size={17} strokeWidth={1.5} aria-hidden="true" className="hidden dark:block" />
    </Button>
  )
}
