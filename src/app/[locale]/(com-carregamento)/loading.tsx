'use client'
/**
 * Estado global de carregamento (issue #54) — fallback de Suspense do segmento, renderizado
 * DENTRO do LocaleProvider do layout, então `useLocale()` é seguro aqui. Mostra um esqueleto
 * tokenizado (performance percebida) + o texto localizado messages.system.loading pro leitor
 * de tela, dentro do landmark <main> (consistente com error/not-found). Motion respeita
 * prefers-reduced-motion (gate global no globals.css).
 *
 * Mora no grupo `(com-carregamento)`, que tem todas as rotas de `[locale]` MENOS `recipes/`. Um
 * `loading.tsx` abre um Suspense que manda o HTML (com status 200) antes de a página terminar, então
 * um `notFound()`/`permanentRedirect()` dentro dela vira 404/308 só no payload, com a resposta já em
 * 200. As rotas de `recipes/` ficam fora para responder 404 e 308 de verdade (ADR-0020 decisão 4);
 * numa navegação no cliente, a página anterior fica na tela até a receita chegar. URLs não mudam: o
 * nome entre parênteses não entra no caminho.
 */
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'

function LoadingSkeleton() {
  return (
    <div aria-hidden className="animate-pulse">
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
    <Container as="main" className="py-16">
      <div role="status" aria-busy="true">
        <span className="sr-only">{messages.system.loading}</span>
        <LoadingSkeleton />
      </div>
    </Container>
  )
}
