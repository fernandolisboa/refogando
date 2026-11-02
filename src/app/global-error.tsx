'use client'
/**
 * Boundary do ROOT layout (issue #590). O `src/app/[locale]/error.tsx` não cobre o layout do mesmo
 * segmento — e o `[locale]/layout.tsx` é o root layout (renderiza `<html>`/`<body>`). Sem este arquivo, um
 * erro lá caía no `global-error` embutido do Next: tela crua em inglês e nenhum relato.
 *
 * Substitui o root layout quando ativo, então traz `<html>`/`<body>` e o CSS global próprios. Fica fora do
 * `LocaleProvider`: o texto e o `lang` vêm do pathname (`useLocaleFromPath`, seguro para o pré-render do
 * build). Sem o `THEME_INIT_SCRIPT`: este documento é montado pelo React no cliente, onde o script inline não
 * roda; o `ThemeCookieSync` reaplica o tema do cookie antes da pintura.
 *
 * Nome `RootGlobalError` (o `GlobalError` já é o da boundary de `[locale]/error.tsx`). "Tentar de novo" usa o
 * `retry` do Next (re-busca e re-renderiza; estável desde a 16.3, antes `unstable_retry`, que ainda é aceito se
 * vier); sem nenhum dos dois, recarrega a página.
 */
import './globals.css'
import { GlobalErrorScreen, useLocaleFromPath } from '@/components/global-error-screen'
import { ThemeCookieSync } from '@/components/theme-cookie-sync'
import { DEFAULT_THEME_CLASS } from '@/lib/theme'

export default function RootGlobalError({
  error,
  retry: nextRetry,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  retry?: () => void
  unstable_retry?: () => void
}) {
  const locale = useLocaleFromPath()
  const retry =
    typeof nextRetry === 'function'
      ? nextRetry
      : typeof unstable_retry === 'function'
        ? unstable_retry
        : () => window.location.reload()
  return (
    <html lang={locale} className={DEFAULT_THEME_CLASS} suppressHydrationWarning>
      <body className="flex min-h-svh flex-col">
        <title>Refogando</title>
        <ThemeCookieSync />
        <GlobalErrorScreen error={error} retry={retry} />
      </body>
    </html>
  )
}
