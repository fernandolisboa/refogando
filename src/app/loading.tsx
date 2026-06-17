'use client'
/**
 * Estado global de carregamento (issue #54) — fallback de Suspense do segmento, renderizado
 * DENTRO do LocaleProvider do layout, então `useLocale()` é seguro aqui. Mostra um esqueleto
 * tokenizado (performance percebida) + o texto localizado messages.system.loading pro leitor
 * de tela. Motion respeita prefers-reduced-motion (gate global no globals.css).
 */
import { useLocale } from '@/i18n/provider'

export function LoadingSkeleton() {
  return (
    <div aria-hidden className="mx-auto max-w-page animate-pulse px-4 py-16 sm:px-6">
      <div className="h-10 w-2/3 rounded-lg bg-surface" />
      <div className="mt-4 h-5 w-1/2 rounded-md bg-surface" />
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        <div className="h-32 rounded-xl bg-surface" />
        <div className="h-32 rounded-xl bg-surface" />
        <div className="h-32 rounded-xl bg-surface" />
      </div>
    </div>
  )
}

export default function Loading() {
  const { messages } = useLocale()
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{messages.system.loading}</span>
      <LoadingSkeleton />
    </div>
  )
}
