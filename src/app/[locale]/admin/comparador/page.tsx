/**
 * Seção "Comparador" (#425, ADR-0029 dec.7, Governança) — admin-only. Revalida o papel server-side
 * com `min='admin'` (um Curador batendo direto aqui é barrado por `AccessDenied`, não só pelo link
 * escondido). A rota `/api/admin/prompt-compare` reforça `requireRole 'admin'`. Espelha ia/page.tsx.
 *
 * Portão de qualidade antes de embarcar um prompt novo: roda os briefings FIXOS pelo prompt VELHO
 * (snapshot congelado) vs. o NOVO (buildSystemPrompt vivo) e mostra Receita+imagem lado a lado. É
 * SÓ-LEITURA — não persiste nada, não estende o seam.
 */
import { SectionGate } from '../gate'
import { PromptComparator } from '@/components/admin/prompt-comparator'
import { loggedInPageMetadata } from '@/server/http/page-metadata'

export const runtime = 'nodejs'

// #462: título fino ("Comparador") + noindex — casa o rótulo da aba do Console (admin-only).
export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return loggedInPageMetadata(params, (m) => m.admin.navComparador)
}

export default async function AdminComparadorPage() {
  return (
    <SectionGate min="admin">
      <PromptComparator />
    </SectionGate>
  )
}
