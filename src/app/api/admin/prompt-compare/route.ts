import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { appConfig } from '@/db/schema'
import { DEFAULT_TEXT_MODEL } from '@/domain/claude-models'
import { runComparison } from '@/server/generation/compare'
import { FIXED_BRIEFINGS, type ComparisonResponse } from '@/domain/prompt-comparator'

/**
 * Comparador de prompt antes/depois (issue #425, ADR-0029 dec.7) — ADMIN-ONLY (Curador/Usuário → 403;
 * sem sessão → 401; espelha `/api/admin/web-search/probe`). Roda os DOIS lados (velho vs. novo) de UMA
 * fixture por request (fan-out por-fixture no cliente): rodar as ~10 fixtures numa só chamada estouraria
 * o `maxDuration` de 60s (cada lado é uma geração de ~8-15s no Opus). NÃO persiste NADA — o único toque
 * de DB é a leitura de `app_config` para resolver o modelo, igual às rotas de geração.
 *
 * SEGURANÇA: `requireRole('admin')` é a defesa de ROTA (o `SectionGate min='admin'` guarda a página). O
 * `requireRole` é fail-OPEN por bug conhecido para papel null/desconhecido, mas aqui só um AUTENTICADO
 * com papel < admin chega, e `decideRole` o barra (403). Read-only + admin-only ⇒ sem quota (como o probe).
 *
 * Runtime nodejs (SDK Anthropic/Gemini + postgres-js exigem Node). `maxDuration=60` dá folga para os dois
 * lados (+ imagem opcional) de uma fixture.
 */

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request): Promise<Response> {
  const g = await requireRole(req, 'admin')
  if (!g.ok) return g.response

  const body = (await req.json().catch(() => ({}))) as { fixtureIndex?: unknown; withImage?: unknown }

  // fixtureIndex: inteiro dentro da faixa das fixtures fixas. Fora → 400 (sem tocar o seam).
  if (
    typeof body.fixtureIndex !== 'number' ||
    !Number.isInteger(body.fixtureIndex) ||
    body.fixtureIndex < 0 ||
    body.fixtureIndex >= FIXED_BRIEFINGS.length
  ) {
    return Response.json({ error: 'fixture_invalida' }, { status: 400 })
  }
  const fixture = FIXED_BRIEFINGS[body.fixtureIndex]
  const withImage = body.withImage === true

  // Modelo de `app_config` (default em código quando a linha singleton está ausente) — mesma fonte
  // única das rotas de geração. Único toque de DB desta rota (leitura); NADA é escrito.
  const [cfg] = await getDb().select().from(appConfig)
  const model = cfg?.defaultModel ?? DEFAULT_TEXT_MODEL

  // Os dois lados em paralelo (velho vs. novo) — cabe no orçamento de 60s de UMA fixture.
  const [oldSide, newSide] = await Promise.all([
    runComparison(fixture, 'old', { model, withImage }),
    runComparison(fixture, 'new', { model, withImage }),
  ])

  const response: ComparisonResponse = { fixtureId: fixture.id, old: oldSide, new: newSide }
  return Response.json(response)
}
