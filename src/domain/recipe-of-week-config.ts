/**
 * "Receita da semana" (#457) — slot EDITORIAL fixo na home destacando 1 Receita do CATÁLOGO por
 * semana, escolhida pelo Curador. PURO: tipos + default + validação. Espelha a forma dos demais
 * eixos do singleton `app_config` (`social-links-config`/`catalog-disclosure-config`): fonte ÚNICA
 * compartilhada pela leitura (server → home) e pelo PUT do admin.
 *
 * Forma DELIBERADAMENTE mínima: `{ recipeId: string | null }`. `null` (default) = "ninguém
 * escolheu ainda" ⇒ a leitura (`recipe-of-week.ts`) cai no FALLBACK automático por Popularidade
 * (a receita mais popular do catálogo aprovado). Guardar só o id (não título/slug/locale) evita
 * qualquer cópia que possa DIVERGIR do estado real da Receita (ex.: título editado depois, ou a
 * receita sendo rejeitada/despublicada do catálogo) — a leitura sempre RE-VALIDA o id contra o
 * estado atual (`origin=catalog AND curation_status=approved`) e degrada pro fallback se o id
 * salvo não casar mais (ADR-0026: rascunho/rejeitado NUNCA aparece em superfície pública).
 *
 * NÃO colide com o guarda-corpo "popularidade-sem-autoridade" (CONTEXT.md, eixo Popularidade): esse
 * guarda-corpo é sobre a Popularidade decidir o que ENTRA no catálogo ou o que é confiável — aqui a
 * Popularidade não promove nada a catálogo (a receita já É catálogo aprovado) e só assume um papel
 * MECÂNICO de last-resort quando a curadoria humana está ausente. Quem controla o slot
 * primariamente é o Curador (escolha explícita), nunca o dono via popularidade.
 */

import { isUuid } from '@/domain/uuid'

/** Config do slot: o id da Receita escolhida (uuid) ou `null` (nenhuma escolha ⇒ fallback). */
export type RecipeOfWeekConfig = { recipeId: string | null }

/** Default: SEM escolha — a home cai no fallback de Popularidade até o Curador escolher. */
export const DEFAULT_RECIPE_OF_WEEK_CONFIG: RecipeOfWeekConfig = { recipeId: null }

export type RecipeOfWeekConfigParse = { ok: true; value: RecipeOfWeekConfig } | { ok: false }

/**
 * Valida o corpo cru do PUT do admin: objeto `{ recipeId }` com `recipeId` sendo `null` OU uma
 * string com FORMA de uuid (a existência/elegibilidade — catálogo+aprovado — é responsabilidade da
 * ESCRITA, `recipe-of-week.ts`, que faz um SELECT antes de persistir; este parser é só de FORMA,
 * espelhando `parseSocialLinksConfig`/`parseCatalogDisclosureConfig`). Substituição COMPLETA do
 * eixo. PURO: sem DB/I/O.
 */
export function parseRecipeOfWeekConfig(raw: unknown): RecipeOfWeekConfigParse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false }
  const obj = raw as { recipeId?: unknown }
  if (obj.recipeId === null) return { ok: true, value: { recipeId: null } }
  if (typeof obj.recipeId !== 'string' || !isUuid(obj.recipeId)) return { ok: false }
  return { ok: true, value: { recipeId: obj.recipeId } }
}
