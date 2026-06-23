/**
 * Rota `/create` — SHELL de deep-link (#191, ADR-0021 dec. 2). A tela de página inteira (#104,
 * toggle Formulário ↔ Conversa) morreu; a rota vira um Server Component fino cujo trabalho passa
 * a ser ABRIR o drawer "Nova receita" (`CreateShellClient` → `CreateDrawer`), semeado pelos três
 * deep-links que já existiam (`?q`, `?resume`, `?mode=conversa`). A URL e seus deep-links
 * sobrevivem; o INTERIOR de página inteira é que sai. NÃO resolve sessão (o guard é no cliente; o
 * gate de escrita real é server-side no handler de geração) e NÃO faz fetch. URL em inglês.
 *
 * O `<main>` segue sendo provido aqui (single-main do documento); o drawer renderiza num Portal
 * por cima da chrome. O `<h1>` localizado segue VIVENDO dentro do componente interno de criação
 * (seam de heading, F1 cancelado) — não sobe pro shell.
 *
 * <Suspense> é OBRIGATÓRIO: `CreateShellClient` lê `useSearchParams`, e o Next exige um boundary
 * de Suspense acima de qualquer leitura de search params (senão o build de produção falha com
 * `useSearchParams() should be wrapped in a suspense boundary`).
 */
import { Suspense } from 'react'
import { Container } from '@/components/container'
import { CreateShellClient } from '@/components/recipe/create-shell-client'

export default function CreatePage() {
  return (
    <Container as="main" size="reading" className="py-8 sm:py-12">
      <Suspense>
        <CreateShellClient />
      </Suspense>
    </Container>
  )
}
