import { sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { webSearchUsageDaily } from '@/db/schema'
import { DAILY_WEB_SEARCH_QUERY_CAP, utcDayKey } from '@/domain/web-search-budget'

/**
 * RESERVA ATÔMICA de `count` consultas Brave no teto de GASTO diário (#464), fechando a corrida TOCTOU
 * ANTES de tocar o provedor pago. Espelha a disciplina do gate de cota de geração (`quota/atomic.ts`):
 * a decisão "cabe no teto?" e a escrita acontecem numa ÚNICA operação atômica, sem read-then-act.
 *
 * O contador é GLOBAL (uma linha por dia UTC), então não há chave por-usuário para um advisory lock;
 * a serialização vem do LOCK DE LINHA do `ON CONFLICT DO UPDATE`. Um único statement (via query builder):
 *
 *   INSERT INTO web_search_usage_daily (day, query_count) VALUES (:day, :count)
 *   ON CONFLICT (day) DO UPDATE SET query_count = query_count + :count, updated_at = now()
 *     WHERE query_count + :count <= :cap
 *   RETURNING query_count
 *
 * Semântica (o bare `query_count` no SET/WHERE = valor EXISTENTE da linha, não o proposto):
 *  - Dia SEM linha ainda ⇒ o INSERT cria com `query_count = count` (primeira chamada do dia) ⇒ RETURNING
 *    devolve a linha ⇒ RESERVADO. (`count` ≤ `MAX_SITE_QUERIES` ≪ teto, então a 1ª do dia sempre cabe.)
 *  - Dia COM linha e `atual + count <= cap` ⇒ o DO UPDATE incrementa sob o lock de linha ⇒ RETURNING
 *    devolve ⇒ RESERVADO.
 *  - Dia COM linha e `atual + count > cap` ⇒ o WHERE do DO UPDATE é falso ⇒ nada atualiza, o INSERT foi
 *    suprimido pelo conflito ⇒ RETURNING vem VAZIO ⇒ ESTOUROU (retorna `false`, o endpoint degrada).
 *
 * Sob concorrência (N chamadas simultâneas no mesmo dia), o lock de linha serializa: só as que ainda
 * cabem no teto veem o WHERE verdadeiro e reservam; as demais recebem zero linhas → `false`. Nunca
 * passa do teto (sem overshoot de corrida). NÃO lança em caminho normal; a decisão é o booleano.
 *
 * `count <= 0` ⇒ no-op reservado (`true`) sem tocar o banco (nada a cobrar).
 */
export async function reserveWebSearchQueries(
  db: Database,
  input: { count: number; now?: Date },
): Promise<boolean> {
  const count = Math.trunc(input.count)
  if (count <= 0) return true
  // Hardening pós-merge (#464): o `setWhere` do ON CONFLICT só guarda o caminho de UPDATE (dia já com
  // linha). Um INSERT fresco (1ª reserva do dia) NÃO passa pelo WHERE — criaria a linha com
  // `query_count = count` mesmo que `count` estoure o teto do dia inteiro. Nenhuma reserva pode pedir mais
  // que o teto diário de uma vez, então recusamos ANTES do banco. (Na prática `count <= MAX_SITE_QUERIES`
  // ≪ teto, mas o guard fecha o flanco se o teto for recalibrado para baixo abaixo do fan-out.)
  if (count > DAILY_WEB_SEARCH_QUERY_CAP) return false
  const day = utcDayKey(input.now ?? new Date())

  const reserved = await db
    .insert(webSearchUsageDaily)
    .values({ day, queryCount: count })
    .onConflictDoUpdate({
      target: webSearchUsageDaily.day,
      set: {
        queryCount: sql`${webSearchUsageDaily.queryCount} + ${count}`,
        updatedAt: sql`now()`,
      },
      // Reserva o slot só se cabe no teto; senão nada atualiza e o RETURNING vem vazio (estourou).
      setWhere: sql`${webSearchUsageDaily.queryCount} + ${count} <= ${DAILY_WEB_SEARCH_QUERY_CAP}`,
    })
    .returning({ queryCount: webSearchUsageDaily.queryCount })

  return reserved.length > 0
}
