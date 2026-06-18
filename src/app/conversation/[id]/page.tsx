/**
 * Retomada de CONVERSA (#60) — Server Component fino. `/conversation/[id]` retoma a Session de
 * id dado: passa `resumeSessionId` ao cérebro client, que faz GET /api/creation-sessions/[id]
 * para reidratar transcript + Receita + advisory (a posse é re-checada no servidor — 404 p/
 * não-dono). URL em inglês (CONTEXT.md), espelhando /recipes/[id]. Um <main>, um <h1>.
 */
import { Container } from '@/components/container'
import { ConversationExperience } from '@/components/recipe/conversation-experience'

export default async function ConversationResumePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <Container as="main" className="py-8 sm:py-12">
      <ConversationExperience resumeSessionId={id} />
    </Container>
  )
}
