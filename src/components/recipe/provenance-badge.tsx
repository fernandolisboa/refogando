/**
 * Selo de proveniência da Busca (#56) — componente PURO, sem hooks de fetch nem de
 * locale. Recebe a `variant` (classificação de display: `catalogo` vs `comunidade` do domínio,
 * mais `minha` para a PRÓPRIA Receita do viewer — #116/own-label) + o `label` JÁ localizado pelo
 * chamador. Recebendo o rótulo pronto, o selo fica testável isolado e reusável na #57.
 *
 * Regra visual (vive AQUI, derivada da `variant`, não de `origin` cru):
 *  - `catalogo`  → token de Catálogo (verde): `bg-accent-surface text-accent-strong`.
 *  - `comunidade`→ neutro: `bg-surface text-muted border`. Accent NUNCA p/ Comunidade.
 *  - `minha`     → texto de marca (páprica) sobre superfície com borda: `bg-surface
 *    text-brand-ink border border-brand`. Distinto do verde (catálogo) e do muted (comunidade),
 *    SEM cor nova — reusa `brand-ink`/`brand` (pares AA já verificados na #54). Âmbar fica
 *    reservado ao Aviso de restrição (NÃO usado aqui).
 *
 * Cores: pares AA já verificados na #54 — nenhuma cor nova introduzida aqui.
 */
import type { SearchSection } from '@/domain/recipe'

/** Variante visual do selo: as seções do domínio + `minha` (própria do viewer, #116/own-label). */
export type BadgeVariant = SearchSection | 'minha'

const BASE = 'inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium'

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  catalogo: 'bg-accent-surface text-accent-strong',
  comunidade: 'border border-border bg-surface text-muted',
  minha: 'border border-brand bg-surface text-brand-ink',
}

export function ProvenanceBadge({
  variant,
  label,
}: {
  variant: BadgeVariant
  label: string
}) {
  return <span className={`${BASE} ${VARIANT_CLASS[variant]}`}>{label}</span>
}
