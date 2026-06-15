'use client'
/**
 * Provider + hook de locale (issue #4, #4.AC1/AC2/AC4). Segura o locale atual e expõe
 * `messages` + `setLocale`. O locale inicial é resolvido NO SERVIDOR (layout.tsx lê o
 * cookie do Visitante via next/headers + Accept-Language e passa `initialLocale`), então
 * o render do servidor e o primeiro render do client batem — sem hydration mismatch.
 * `setLocale` grava o cookie (D9) e re-renderiza a chrome (#4.AC1). NÃO chama nenhum
 * endpoint de Receita (#4.AC4 — isolamento): o único efeito é cookie + estado.
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { type Locale } from '@/i18n/locale'
import { MESSAGES, type Messages } from '@/i18n/messages'
import { applyLocaleSideEffects } from '@/i18n/cookie'

type Ctx = { locale: Locale; messages: Messages; setLocale: (l: Locale) => void }
const LocaleContext = createContext<Ctx | null>(null)

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale
  children: ReactNode
}) {
  // Sem ler document.cookie/navigator no render: o servidor já resolveu o locale e o
  // passou como prop, então o primeiro render do client é idêntico ao do servidor.
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    // Persiste o cookie do Visitante E sincroniza `<html lang>` com a chrome numa troca em
    // runtime — os dois efeitos vivem juntos em `applyLocaleSideEffects` (cookie.ts) para
    // não divergirem. Sem o sync de `lang`, trocar o idioma deixaria `<html lang>` preso no
    // valor do SSR (a11y/SEO). Guard de `document` para não quebrar em SSR.
    if (typeof document !== 'undefined') applyLocaleSideEffects(document, l)
  }, [])
  return (
    <LocaleContext.Provider value={{ locale, messages: MESSAGES[locale], setLocale }}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useLocale(): Ctx {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale fora de LocaleProvider')
  return ctx
}
