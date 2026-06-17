/**
 * Selo de proveniência da Busca (#56) — componente PURO, sem hooks de fetch nem de
 * locale. Recebe `section` (a classificação canônica do domínio: `catalogo` vs
 * `comunidade`) + o `label` JÁ localizado pelo chamador. Recebendo o rótulo pronto, o
 * selo fica testável isolado e reusável na #57 (ver receita).
 *
 * Regra visual (vive AQUI, derivada de `section`, não de `origin` cru):
 *  - `catalogo`  → token de Catálogo (verde): `bg-accent-surface text-accent-strong`.
 *  - `comunidade`→ neutro: `bg-surface text-muted border`. Accent NUNCA p/ Comunidade.
 *
 * Cores: par AA já verificado na #54 — nenhuma cor nova introduzida aqui.
 */
import type { SearchSection } from '@/domain/recipe'

const BASE = 'inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium'

const SECTION_CLASS: Record<SearchSection, string> = {
  catalogo: 'bg-accent-surface text-accent-strong',
  comunidade: 'border border-border bg-surface text-muted',
}

export function ProvenanceBadge({
  section,
  label,
}: {
  section: SearchSection
  label: string
}) {
  return <span className={`${BASE} ${SECTION_CLASS[section]}`}>{label}</span>
}
