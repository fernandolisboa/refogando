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

export const runtime = 'nodejs'

export default async function AdminComparadorPage() {
  return (
    <SectionGate min="admin">
      <PromptComparator />
    </SectionGate>
  )
}
