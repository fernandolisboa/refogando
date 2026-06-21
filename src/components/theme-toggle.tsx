'use client'
/**
 * Toggle manual de tema claro/escuro (ADR-0018), no header ao lado dos controles da chrome.
 * Espelha o padrão do locale: o servidor lê o cookie `theme` e emite a classe no `<html>`
 * (SSR sem flash, em layout.tsx); aqui o client grava o cookie e alterna a classe no
 * `documentElement`. Botão `<button>` simples por enquanto — vira `<Button>` numa fase
 * posterior (a primitiva ainda não existe).
 *
 * `initialTheme` vem do SERVIDOR (cookie), threadado de layout.tsx → SiteHeader. `null` =
 * usuário nunca escolheu → segue o SO. Como o servidor não lê `prefers-color-scheme`, o
 * primeiro render é um estado NEUTRO estável (assume claro) e só após o mount reconciliamos
 * com `matchMedia` — um guard `mounted` evita hydration mismatch (servidor e 1º render do
 * client batem; o ícone real do SO aparece no useEffect).
 */
import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useLocale } from '@/i18n/provider'
import { THEME_COOKIE, type Theme } from '@/lib/theme'

export function ThemeToggle({ initialTheme }: { initialTheme: Theme | null }) {
  const { messages } = useLocale()
  // Estado efetivo do tema. Antes do mount, `initialTheme ?? 'light'` é estável e idêntico
  // no servidor e no 1º render do client (o SO ainda não foi lido). `mounted` libera o
  // efeito de reconciliação.
  const [theme, setTheme] = useState<Theme>(initialTheme ?? 'light')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    // Sem cookie explícito (segue o SO): lê o `prefers-color-scheme` real do client e
    // alinha o ícone ao tema que o CSS já está aplicando via @media. Com cookie, o estado
    // inicial já é o certo.
    if (initialTheme === null && typeof window !== 'undefined' && window.matchMedia) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      setTheme(prefersDark ? 'dark' : 'light')
    }
  }, [initialTheme])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    // Persiste a preferência (1 ano; Path=/; SameSite=Lax — só apresentação, igual ao locale)
    // E alterna a classe no <html>, que o CSS usa para sobrescrever o @media do SO.
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    const root = document.documentElement
    root.classList.add(next)
    root.classList.remove(next === 'dark' ? 'light' : 'dark')
  }

  // Antes do mount, mostramos o afford. de "ir pro escuro" (Sun) de forma estável; após o
  // mount o ícone reflete o tema efetivo. O rótulo nomeia o DESTINO da ação (a11y).
  const effective: Theme = mounted ? theme : initialTheme ?? 'light'
  const goingDark = effective !== 'dark'
  const label = goingDark ? messages.theme.dark : messages.theme.light

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="inline-flex size-9 items-center justify-center rounded-md text-fg transition-colors duration-150 ease-out hover:bg-brand/10"
    >
      {goingDark ? (
        <Moon size={17} strokeWidth={1.5} aria-hidden="true" />
      ) : (
        <Sun size={17} strokeWidth={1.5} aria-hidden="true" />
      )}
    </button>
  )
}
