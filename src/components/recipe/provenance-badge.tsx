/**
 * Selo de proveniência da Busca (#56) — wrapper de DOMÍNIO sobre a primitiva `<Badge>`
 * (`ui/badge.tsx`, ADR-0018). Componente PURO, sem hooks de fetch nem de locale. Recebe a
 * `variant` (classificação de display: `catalogo` vs `comunidade` do domínio, mais `minha` para a
 * PRÓPRIA Receita do viewer — #116/own-label) + o `label` JÁ localizado pelo chamador. Recebendo
 * o rótulo pronto, o selo fica testável isolado e reusável na #57.
 *
 * Regra visual (vive na primitiva `<Badge>`; aqui só mapeamos a `variant` de domínio → variante
 * de pele, derivada da `variant`, não de `origin` cru):
 *  - `catalogo`  → `catalog` (erva: `bg-accent-surface text-accent-strong`).
 *  - `comunidade`→ `default` (neutro: borda + superfície + texto secundário). Erva NUNCA p/ Comunidade.
 *  - `minha`     → `mine` (texto de marca/páprica sobre superfície com borda). Distinto do verde
 *    (catálogo) e do neutro (comunidade), SEM cor nova. Âmbar fica reservado ao Aviso (NÃO aqui).
 *
 * Cores: pares AA já verificados na #54 — nenhuma cor nova introduzida aqui.
 */
import { Badge, type badgeVariants } from '@/components/ui/badge'
import type { VariantProps } from 'class-variance-authority'
import type { SearchSection } from '@/domain/recipe'

/** Variante visual do selo: as seções do domínio + `minha` (própria do viewer, #116/own-label). */
export type BadgeVariant = SearchSection | 'minha'

/** Mapa da `variant` de domínio → variante de pele da primitiva `<Badge>`. */
const SKIN_VARIANT: Record<BadgeVariant, VariantProps<typeof badgeVariants>['variant']> = {
  catalogo: 'catalog',
  comunidade: 'default',
  minha: 'mine',
}

export function ProvenanceBadge({
  variant,
  label,
}: {
  variant: BadgeVariant
  label: string
}) {
  return <Badge variant={SKIN_VARIANT[variant]}>{label}</Badge>
}
