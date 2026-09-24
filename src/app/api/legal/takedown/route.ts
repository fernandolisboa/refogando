import { getDb } from '@/server/deps'
import { clientIpFromHeaders, parseRequestLocale } from '@/server/http/params'
import { canonicalLocale } from '@/i18n/locale'
import { normalizeTakedownIntake, type TakedownIntakeInput } from '@/domain/takedown'
import { createTakedownTicket } from '@/server/legal/takedown-intake'
import { createDomainRateLimiter } from '@/server/import/rate-limit'

/**
 * Intake PÚBLICO de pedidos do titular / takedown (issue #399, GAP-2; `docs/legal/takedown-e-remocao-
 * titular.md` §2). POST `{ requestType, sourceUrl?, displayName?, message, contactEmail? }` →
 * `{ ticketId }` (201): abre um ticket (início do SLA de 15 dias) e grava `DSAR_RECEIVED` na mesma
 * transação (via `createTakedownTicket`).
 *
 * SEM SESSÃO (cookie-free): o titular B (autor externo) NÃO tem conta — o formulário é aberto a
 * qualquer pessoa. Não lê cookie, nunca 401. É uma ESCRITA (não cacheável).
 *
 * Anti-500 (espelha `/api/search/cooks`): a validação/sanitização vive no domínio
 * (`normalizeTakedownIntake` — strip C0, trim, cortes, campos obrigatórios). Corpo malformado →
 * `request.json()` cai em `{}` → 400 `dados_invalidos`. Um erro inesperado (soluço de DB) é capturado e
 * responde 500 com chave GENÉRICA `erro` — NUNCA vaza SQL/stack e o handler nunca lança sem tratamento.
 * Não degradamos para "sucesso falso": num INSERT, fingir 201 sem gravar seria mentir para o titular.
 *
 * Throttle (espelha o /import #272): um endpoint público, cookie-free e SEM sessão fica "destravado" —
 * cada envio válido grava um `DSAR_RECEIVED` na trilha append-only de conformidade + um ticket, então um
 * flood soterraria pedidos reais e poluiria a auditoria legal. Aplicamos ~1 envio/s POR IP (best-effort,
 * `createDomainRateLimiter`), ANTES de parsear/tocar o banco → 429 sem corpo detalhado ao exceder.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

// Throttle best-effort POR IP (mesmo motor do /import): estado in-memory NA INSTÂNCIA serverless — cada
// instância tem o seu Map e um cold start zera a janela, então NÃO é quota dura, é politeness/anti-flood.
// Módulo-escopo p/ persistir entre requests da mesma instância. ~1 envio/s por IP.
const takedownThrottle = createDomainRateLimiter({ minIntervalMs: 1000 })

export async function POST(request: Request): Promise<Response> {
  // Anti-flood ANTES de qualquer trabalho (parse/DB/auditoria). IP ausente (local/teste, sem proxy na
  // frente) ⇒ fail-open: não temos chave por-cliente, não punimos todo mundo num balde global.
  const ip = clientIpFromHeaders(request)
  if (ip && !takedownThrottle.tryAcquire(ip)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 }) // sem vazar corpo/detalhe
  }

  const body = (await request.json().catch(() => ({}))) as TakedownIntakeInput
  const parsed = normalizeTakedownIntake(body)
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  // Locale (metadado p/ responder no idioma do titular): valida contra os locales suportados e grava a
  // forma canônica ('PT-br' → 'pt-BR') ou `null` — nunca um `?locale=` cru/ilimitado (um NUL ali estouraria
  // o postgres-js). Capado por construção: só 'pt-BR'/'en-US' conhecidos ou `null`.
  const locale = canonicalLocale(parseRequestLocale(request))

  try {
    const { ticketId } = await createTakedownTicket(getDb(), { ...parsed.value, locale })
    return Response.json({ ticketId }, { status: 201 })
  } catch {
    // Não vaza detalhe do erro; o cliente mostra uma mensagem genérica de "tente novamente".
    return Response.json({ error: 'erro' }, { status: 500 })
  }
}
