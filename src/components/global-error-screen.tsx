'use client'
/**
 * Tela do `src/app/global-error.tsx` (issue #590): o erro que derrubou o PRÓPRIO root layout
 * (`src/app/[locale]/layout.tsx`). Aqui não há `LocaleProvider` nem nada do layout, então o locale sai do
 * 1º segmento do pathname. Separada do arquivo de rota para o teste montar no jsdom sem `<html>`/`<body>`.
 *
 * O `global-error` é pré-renderizado no build: nada de `window` no render. O locale vem de
 * `useSyncExternalStore` com snapshot de servidor `DEFAULT_LOCALE` — o pré-render e a hidratação batem, e o
 * cliente troca para o locale do caminho logo depois.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { Container } from '@/components/container'
import { Button } from '@/components/ui/button'
import { DEFAULT_LOCALE, type Locale } from '@/i18n/locale'
import { splitLocalePrefix } from '@/i18n/locale-path'
import { MESSAGES } from '@/i18n/messages'
import { isChunkLoadError, reloadForAppUpdate } from '@/lib/app-update-reload'
import { reportClientError } from '@/lib/client-error-report'

const noopSubscribe = () => () => {}

/** Locale do 1º segmento de `location.pathname` (fallback `DEFAULT_LOCALE`), seguro para pré-render. */
export function useLocaleFromPath(): Locale {
  return useSyncExternalStore(
    noopSubscribe,
    () => splitLocalePrefix(window.location.pathname).locale ?? DEFAULT_LOCALE,
    () => DEFAULT_LOCALE,
  )
}

export function GlobalErrorScreen({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const { system } = MESSAGES[useLocaleFromPath()]
  useEffect(() => {
    // Mesmo trato da boundary de `[locale]/error.tsx`: chunk velho pós-deploy ⇒ reload quieto e one-shot
    // (ADR-0028 dec 5); o resto vira uma linha no log do servidor (ADR-0048).
    if (isChunkLoadError(error, error.message)) reloadForAppUpdate()
    else reportClientError('global', error)
  }, [error])
  return (
    <Container as="main" className="flex flex-col items-start gap-5 py-24">
      <h1 className="font-display text-3xl font-semibold text-fg">{system.error}</h1>
      <Button type="button" onClick={retry}>
        {system.retry}
      </Button>
    </Container>
  )
}
