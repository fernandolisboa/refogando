import { and, isNull, isNotNull } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { briefingItem } from '@/db/schema'
import { normalizeText } from '@/domain/recipe-restrictions'

/**
 * Lista de PROMOÇÃO de ingredientes livres recorrentes (issue #19, AC5) — READ-ONLY.
 *
 * Agrega `briefing_item` LIVRES (ingredient_id IS NULL, ou seja, ainda não canônicos) com
 * `raw_text` presente, agrupando por chave NORMALIZADA (`normalizeText` — a MESMA fonte
 * única do domínio que `briefing.ts` usa para dedup; sem drift SQL↔TS). Filtra por
 * threshold ('recorrente' = aparece ≥ PROMOTION_THRESHOLD vezes), ordena por count desc
 * com tiebreak determinístico pela chave normalizada. Devolve o surface representativo
 * (primeiro visto) + count. Itens já canônicos (ingredient_id NOT NULL) são EXCLUÍDOS.
 *
 * Agregação em JS (não SQL): reusa `normalizeText` do domínio (fonte única) e as tabelas
 * são pequenas no v1. Reversível para GROUP BY se virar gargalo.
 */

export const PROMOTION_THRESHOLD = 2

export async function promotionList(
  db: Database,
): Promise<{ rawText: string; count: number }[]> {
  const rows = await db
    .select({ rawText: briefingItem.rawText })
    .from(briefingItem)
    .where(and(isNull(briefingItem.ingredientId), isNotNull(briefingItem.rawText)))

  // Map<chave normalizada, { raw: surface representativo, count }>.
  const buckets = new Map<string, { raw: string; count: number }>()
  for (const row of rows) {
    if (row.rawText == null) continue // defensivo (o WHERE já filtra)
    const key = normalizeText(row.rawText)
    if (key.length === 0) continue
    const existing = buckets.get(key)
    if (existing) existing.count++
    else buckets.set(key, { raw: row.rawText, count: 1 })
  }

  return [...buckets.entries()]
    .filter(([, v]) => v.count >= PROMOTION_THRESHOLD)
    .sort(([ka, a], [kb, b]) => b.count - a.count || ka.localeCompare(kb))
    .map(([, v]) => ({ rawText: v.raw, count: v.count }))
}
