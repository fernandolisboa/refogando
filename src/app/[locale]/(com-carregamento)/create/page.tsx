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
import { connection } from 'next/server'
import { Container } from '@/components/container'
import { CreateShellClient } from '@/components/recipe/create-shell-client'
import { loggedInPageMetadata } from '@/server/http/page-metadata'

// #462: título fino ("Criar receita") + noindex (só-logado — o cliente gateia Visitante).
export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return loggedInPageMetadata(params, (m) => m.criar.titulo)
}

export default async function CreatePage() {
  // Segue DINÂMICA de propósito (achado A da auditoria de performance, handoff 67). Quando o root layout
  // deixou de ler o cookie do tema, esta rota viraria estática, e numa rota estática o `useSearchParams`
  // do `CreateShellClient` cai no fallback do `<Suspense>` no servidor (bailout para render só no
  // client) em vez de renderizar com os deep-links. Fica como era até alguém decidir o contrário.
  await connection()
  return (
    <Container as="main" size="reading" className="py-8 sm:py-12">
      <Suspense>
        <CreateShellClient />
      </Suspense>
    </Container>
  )
}
