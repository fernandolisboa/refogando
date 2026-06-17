'use client'
/**
 * Home (issue #54). Hero editorial usando o shell + os tokens de design. Mantém o uso de
 * `useLocale()` (prova viva de #4.AC1: trocar o seletor no header alterna a chrome inteira,
 * incluindo este texto). Sem UI de login/listagem aqui — as telas reais são as fatias
 * #55–#59 (busca, ver receita, criar, salvar/publicar).
 */
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'

export default function Home() {
  const { messages } = useLocale()
  return (
    <Container as="main" className="py-20 sm:py-28">
      <div className="max-w-2xl">
        <span aria-hidden className="inline-block h-1.5 w-12 rounded-full bg-brand" />
        <h1 className="mt-6 font-display text-5xl font-semibold tracking-tight text-fg sm:text-6xl">
          {messages.app.name}
        </h1>
        <p className="mt-5 max-w-prose text-lg leading-relaxed text-muted sm:text-xl">
          {messages.app.tagline}
        </p>
      </div>
    </Container>
  )
}
