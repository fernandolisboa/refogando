/**
 * Tela CRIAR estruturada (#58) — Server Component fino. Provê o ÚNICO `<main>` do documento
 * via <Container as="main"> e monta o orquestrador client. NÃO resolve sessão (o guard é no
 * cliente — o gate de escrita real é server-side no handler) e NÃO faz fetch. URL em inglês
 * (CONTEXT.md). O `<h1>` localizado vive dentro do componente client (um <main>, um <h1>).
 */
import { Container } from '@/components/container'
import { CreateStructuredExperience } from '@/components/recipe/create-structured-experience'

export default function CreatePage() {
  return (
    <Container as="main" className="py-8 sm:py-12">
      <CreateStructuredExperience />
    </Container>
  )
}
