import { sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import {
  type AiCostSummary,
  type AiCostDay,
  type AiCostUser,
  type AiCostByOutcome,
  AI_COST_DEFAULT_WINDOW_DAYS,
  AI_COST_TOP_USERS,
} from '@/domain/ai-cost-read'

/**
 * Agregador do painel de CUSTO de IA no /admin (#465) — soma os DOIS ledgers de custo já existentes:
 * `generation` (texto, #463) e `image_generation` (imagem, #224). NÃO cria tabela nova; só LÊ os
 * `cost_usd` SNAPSHOT já persistidos. ADMIN-only (a rota reforça `requireRole 'admin'`).
 *
 * Três vistas, TODAS na mesma janela de `windowDays` (default 30):
 *  1. `perDay` — custo/dia por ledger (série temporal de margem).
 *  2. `topUsers` — custo/usuário top-N (detecção de abuso / heavy users).
 *  3. `byOutcome` — custo do TEXTO correlacionado a engajamento (Receita salva/avaliada) — responde
 *     "quanto do gasto virou Receita que as pessoas guardam" (o carimbo de custo do #463 fecha o loop
 *     com o promptStamp/desfecho que motivou o ledger).
 *
 * Best-effort/NULL-honesto: linhas com `cost_usd IS NULL` (telemetria ausente / legadas) NÃO entram nas
 * somas — o total reflete só o medido. `cost_usd` é numeric; somado e devolvido como `float8` (precisão
 * de dashboard). A janela é parametrizada via `make_interval(days => $n)` (bind, nunca concat de string).
 *
 * AGREGAÇÃO SEM FAN-OUT: cada ledger é somado SEPARADO (UNION ALL de linhas já rotuladas texto/imagem) —
 * NUNCA um JOIN entre ledgers (multiplicaria linhas). O custo/usuário do texto passa por
 * `generation → creation_session` (a sessão carrega o `user_id`); o da imagem já tem `user_id` na linha.
 */
export async function loadAiCostSummary(
  db: Database,
  opts: { windowDays?: number; topN?: number } = {},
): Promise<AiCostSummary> {
  const windowDays = opts.windowDays ?? AI_COST_DEFAULT_WINDOW_DAYS
  const topN = opts.topN ?? AI_COST_TOP_USERS
  const since = sql`now() - make_interval(days => ${windowDays})`

  // ── 1. Custo/dia por ledger (UNION ALL rotulado; some por dia UTC) ──────────────────────────────
  const dayRows = await db.execute<{ day: string; text_usd: number; image_usd: number }>(sql`
    SELECT day, SUM(text_usd)::float8 AS text_usd, SUM(image_usd)::float8 AS image_usd
    FROM (
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             cost_usd AS text_usd, 0::numeric AS image_usd
        FROM generation
        WHERE cost_usd IS NOT NULL AND created_at >= ${since}
      UNION ALL
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             0::numeric AS text_usd, cost_usd AS image_usd
        FROM image_generation
        WHERE cost_usd IS NOT NULL AND created_at >= ${since}
    ) t
    GROUP BY day
    ORDER BY day ASC
  `)
  const perDay: AiCostDay[] = dayRows.map((r) => ({
    day: r.day,
    textUsd: r.text_usd,
    imageUsd: r.image_usd,
  }))

  // ── 2. Custo/usuário top-N (texto via creation_session; imagem direta) ───────────────────────────
  const userRows = await db.execute<{
    user_id: string
    handle: string | null
    email: string
    text_usd: number
    image_usd: number
    total_usd: number
  }>(sql`
    SELECT u.id AS user_id, u.handle, u.email,
           SUM(x.text_usd)::float8 AS text_usd,
           SUM(x.image_usd)::float8 AS image_usd,
           SUM(x.text_usd + x.image_usd)::float8 AS total_usd
    FROM (
      SELECT cs.user_id AS uid, g.cost_usd AS text_usd, 0::numeric AS image_usd
        FROM generation g
        JOIN creation_session cs ON cs.id = g.creation_session_id
        WHERE g.cost_usd IS NOT NULL AND g.created_at >= ${since}
      UNION ALL
      SELECT ig.user_id AS uid, 0::numeric AS text_usd, ig.cost_usd AS image_usd
        FROM image_generation ig
        WHERE ig.cost_usd IS NOT NULL AND ig.created_at >= ${since}
    ) x
    JOIN users u ON u.id = x.uid
    GROUP BY u.id, u.handle, u.email
    ORDER BY total_usd DESC, u.id ASC
    LIMIT ${topN}
  `)
  const topUsers: AiCostUser[] = userRows.map((r) => ({
    userId: r.user_id,
    handle: r.handle,
    email: r.email,
    textUsd: r.text_usd,
    imageUsd: r.image_usd,
    totalUsd: r.total_usd,
  }))

  // ── 3. Custo do TEXTO por desfecho (salvo/avaliado) ──────────────────────────────────────────────
  // Correlação por EXISTS (não JOIN — evita fan-out se a Receita tem N saves/reviews). Só gerações COM
  // Receita e custo entram; saved/starred se sobrepõem (dois indicadores, não partição).
  const [outcome] = await db.execute<{
    total_usd: number
    total_count: number
    saved_usd: number
    saved_count: number
    starred_usd: number
    starred_count: number
  }>(sql`
    SELECT
      COALESCE(SUM(g.cost_usd), 0)::float8 AS total_usd,
      COUNT(*)::int AS total_count,
      COALESCE(SUM(g.cost_usd) FILTER (WHERE saved), 0)::float8 AS saved_usd,
      COUNT(*) FILTER (WHERE saved)::int AS saved_count,
      COALESCE(SUM(g.cost_usd) FILTER (WHERE starred), 0)::float8 AS starred_usd,
      COUNT(*) FILTER (WHERE starred)::int AS starred_count
    FROM generation g
    CROSS JOIN LATERAL (
      SELECT EXISTS (SELECT 1 FROM recipe_save rs WHERE rs.recipe_id = g.recipe_id) AS saved,
             EXISTS (SELECT 1 FROM recipe_review rr WHERE rr.recipe_id = g.recipe_id) AS starred
    ) e
    WHERE g.recipe_id IS NOT NULL AND g.cost_usd IS NOT NULL AND g.created_at >= ${since}
  `)
  const byOutcome: AiCostByOutcome = {
    totalUsd: outcome?.total_usd ?? 0,
    totalCount: outcome?.total_count ?? 0,
    savedUsd: outcome?.saved_usd ?? 0,
    savedCount: outcome?.saved_count ?? 0,
    starredUsd: outcome?.starred_usd ?? 0,
    starredCount: outcome?.starred_count ?? 0,
  }

  const textUsd = perDay.reduce((acc, d) => acc + d.textUsd, 0)
  const imageUsd = perDay.reduce((acc, d) => acc + d.imageUsd, 0)

  return {
    windowDays,
    totals: { textUsd, imageUsd, totalUsd: textUsd + imageUsd },
    perDay,
    topUsers,
    byOutcome,
  }
}
