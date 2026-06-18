/**
 * Tela CONVERSA (#60) — Server Component fino. Provê o ÚNICO `<main>` do documento via
 * <Container as="main"> e monta o cérebro client. URL em inglês (CONTEXT.md): /conversation
 * para uma conversa NOVA; /conversation/[id] retoma uma Session existente. NÃO resolve sessão
 * (o guard é no cliente; o gate de escrita real é server-side nos handlers) e NÃO faz fetch.
 * O `<h1>` localizado vive dentro do componente client (um <main>, um <h1>).
 */
import { Container } from '@/components/container'
import { ConversationExperience } from '@/components/recipe/conversation-experience'

export default function ConversationPage() {
  return (
    <Container as="main" className="py-8 sm:py-12">
      <ConversationExperience />
    </Container>
  )
}
