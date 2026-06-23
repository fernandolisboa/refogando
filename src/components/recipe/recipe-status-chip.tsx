/**
 * Chip de STATUS de Visibilidade (#195/ADR-0021 decisão 4) — substitui o controle inline de
 * Visibilidade no detalhe só-leitura. NÃO-clicável (um `<span>`, sem botão/link): o dono só vê o
 * estado de relance (Privada/Pública). A AÇÃO de publicar/despublicar migrou para o toggle rascunho
 * DENTRO do modal de edição (`RecipeEditForm`), que comita no Salvar por request separado.
 *
 * Componente PURO (sem hooks/fetch), irmão do `RecipeDetailView`: a page o renderiza só pro dono
 * (`canManage` + `visibility`). Tokens NEUTROS (ADR-0004: âmbar é exclusivo do Aviso de restrição).
 */
import type { Visibility } from '@/domain/recipe'
import type { Messages } from '@/i18n/messages'

export function RecipeStatusChip({
  visibility,
  m,
}: {
  visibility: Visibility
  m: Messages
}) {
  const v = m.visibilidade
  const isPublic = visibility === 'public'
  const estado = isPublic ? v.publicaBadge : v.privadaBadge
  return (
    <p className="flex items-center gap-2 text-sm text-muted">
      <span>{v.chipRotulo}:</span>
      <span className="rounded-full border border-border bg-surface px-3 py-0.5 font-medium text-fg">
        {estado}
      </span>
    </p>
  )
}
