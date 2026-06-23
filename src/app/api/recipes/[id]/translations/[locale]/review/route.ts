import { and, eq } from 'drizzle-orm'
import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { canonicalLocale } from '@/i18n/locale'
import { recipe, recipeTranslation } from '@/db/schema'
import { isCommunityVisible } from '@/domain/recipe-visibility-check'

/**
 * Curador remove a sinalização de uma tradução automática (issue #23, AC2.1):
 * `automatica_nao_revisada` → `automatica_revisada`. Age por PAPEL (curador), não por
 * ownership. SÓ receita da COMUNIDADE (pública OU owner_id NULL) — curador NÃO toca
 * conteúdo PRIVADO de usuário (isso é #18, must-fix de escopo ADR-0011): 404 leak-safe.
 *
 * #18 (moderação): uma Receita removida do pool pelo Curador (`moderation_removed_at`) saiu
 * do pool SEM tocar `visibility` (AC3) — o gate de comunidade aqui exige também
 * `moderation_removed_at IS NULL`, senão o Curador poderia des-sinalizar a tradução de uma
 * Receita já moderada. Espelha a cláusula de moderação de `recipe-pool.ts` (404 leak-safe).
 *
 * NÃO toca `stale` nem re-embeda (proveniência ≠ conteúdo); só bump `updatedAt`. O WHERE
 * com `provenance = 'automatica_nao_revisada'` protege contra rebaixar `escrita_por_pessoa`
 * e torna o flip idempotente (já-revisada ⇒ 0 linhas afetadas, ainda 200).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; locale: string }> },
): Promise<Response> {
  const { id, locale: rawLocale } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const locale = canonicalLocale(rawLocale)
  if (locale === null) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireRole(request, 'curador')
  if (!g.ok) return g.response

  const db = getDb()

  // GATE de comunidade (ADR-0011): curador NÃO toca receita privada (isso é #18). 404 leak-safe.
  // #18: nem Receita removida do pool pela moderação (saiu do pool sem tocar visibility, AC3).
  const [gate] = await db
    .select({
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      moderationRemovedAt: recipe.moderationRemovedAt,
    })
    .from(recipe)
    .where(eq(recipe.id, id))
  if (!gate) return Response.json({ error: 'not_found' }, { status: 404 })
  const isCommunity =
    isCommunityVisible(gate.ownerId, gate.visibility) && gate.moderationRemovedAt == null
  if (!isCommunity) return Response.json({ error: 'not_found' }, { status: 404 })

  // Confirma a existência da LINHA (404 leak-safe, separado do efeito idempotente).
  const [row] = await db
    .select({ id: recipeTranslation.id })
    .from(recipeTranslation)
    .where(and(eq(recipeTranslation.recipeId, id), eq(recipeTranslation.locale, locale)))
  if (!row) return Response.json({ error: 'not_found' }, { status: 404 })

  // Flip SÓ quando automatica_nao_revisada (não rebaixa escrita_por_pessoa); bump updatedAt
  // (sem $onUpdate no Drizzle). Já-revisada ⇒ 0 linhas afetadas, ainda 200 (idempotente).
  // CONGELAMENTO do slug (#243, ADR-0020 dec.4): promover a procedência NÃO toca `slug` — a URL
  // canônica (congelada no 1º insert via freezeSlug) é estável sob revisão. O SET não inclui `slug`.
  await db
    .update(recipeTranslation)
    .set({ provenance: 'automatica_revisada', updatedAt: new Date() })
    .where(
      and(
        eq(recipeTranslation.recipeId, id),
        eq(recipeTranslation.locale, locale),
        eq(recipeTranslation.provenance, 'automatica_nao_revisada'),
      ),
    )

  return Response.json({ ok: true }, { status: 200 })
}
