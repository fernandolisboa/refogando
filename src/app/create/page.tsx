/**
 * Tela CRIAR unificada (#104) — Server Component fino. Provê o ÚNICO `<main>` do documento via
 * <Container as="main"> e monta o orquestrador client `CreatePageClient` (toggle Formulário ↔
 * Conversa). NÃO resolve sessão (o guard é no cliente — o gate de escrita real é server-side no
 * handler) e NÃO faz fetch. URL em inglês (CONTEXT.md). Os `<h1>` localizados vivem dentro dos
 * componentes client (um <main>, um <h1>).
 *
 * <Suspense> é OBRIGATÓRIO: `CreatePageClient` é o PRIMEIRO consumidor de `useSearchParams` do
 * repo, e o Next exige um boundary de Suspense acima de qualquer leitura de search params (senão
 * o build de produção falha com `useSearchParams() should be wrapped in a suspense boundary`).
 */
import { Suspense } from 'react'
import { Container } from '@/components/container'
import { CreatePageClient } from '@/components/recipe/create-page-client'

export default function CreatePage() {
  return (
    <Container as="main" className="py-8 sm:py-12">
      <Suspense>
        <CreatePageClient />
      </Suspense>
    </Container>
  )
}
