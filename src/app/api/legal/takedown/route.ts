import { getDb } from '@/server/deps'
import { clientIpFromHeaders, parseRequestLocale } from '@/server/http/params'
import { canonicalLocale } from '@/i18n/locale'
import { normalizeTakedownIntake, type TakedownIntakeInput } from '@/domain/takedown'
import { createTakedownTicket } from '@/server/legal/takedown-intake'
import { createDomainRateLimiter } from '@/server/import/rate-limit'
import { ipRateKey } from '@/server/http/ip-burst-limit'
import { consumeRateLimits, limiterKey, type RateLimitRule } from '@/server/rate-limit/window'
import { GLOBAL_LIMIT_KEY, RATE_LIMITS, windowStartOf } from '@/domain/rate-limit-rules'

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
 * flood soterraria pedidos reais e poluiria a auditoria legal. Duas camadas:
 *  1. ~1 envio/s POR IP em memória (best-effort, `createDomainRateLimiter`), ANTES de parsear: barato, segura o
 *     martelo de um IP só numa instância quente. Responde 429 `muito_rapido` (o formulário diz "espere um instante":
 *     é um clique duplo, não o limite do formulário);
 *  2. #648 (ADR-0057): limitador PERSISTIDO, depois da validação (lixo não grava nada, então não gasta o teto) e
 *     antes do INSERT: por IP (`takedown_ip`, chave HMAC da /64 ou do IPv4) e no total (`takedown_global`), valendo
 *     para todas as instâncias. Excedeu ⇒ 429 `rate_limited` com `retryAfterMs` e `retry-after`; o formulário mostra
 *     `seusDireitos.erroLimite`, que aponta o e-mail do canal de privacidade (o pedido nunca fica sem via).
 * O e-mail ao Encarregado tem teto próprio por hora (`createTakedownTicket`).
 *
 * Quando o teto TOTAL (`takedown_global`) barra, sai UMA linha `[takedown] limite=atingido bucket=takedown_global` por
 * janela, por instância (sem IP nem conteúdo): é o sinal de uma enxurrada que fechou o formulário para todos.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

// Throttle best-effort POR IP (mesmo motor do /import): estado in-memory NA INSTÂNCIA serverless — cada
// instância tem o seu Map e um cold start zera a janela, então NÃO é quota dura, é politeness/anti-flood.
// Módulo-escopo p/ persistir entre requests da mesma instância. ~1 envio/s por IP.
const takedownThrottle = createDomainRateLimiter({ minIntervalMs: 1000 })

// Início da última janela do teto total em que esta instância já logou o `limite=atingido` (uma linha por janela).
let globalTripLoggedWindow: number | null = null

function logGlobalTrip(now: number): void {
  const start = windowStartOf(now, RATE_LIMITS.takedown_global.windowMs)
  if (globalTripLoggedWindow === start) return
  globalTripLoggedWindow = start
  console.warn('[takedown] limite=atingido bucket=takedown_global')
}

export async function POST(request: Request): Promise<Response> {
  // Anti-flood ANTES de qualquer trabalho (parse/DB/auditoria). IP ausente (local/teste, sem proxy na
  // frente) ⇒ fail-open: não temos chave por-cliente, não punimos todo mundo num balde global.
  const ip = clientIpFromHeaders(request)
  if (ip && !takedownThrottle.tryAcquire(ip)) {
    return Response.json({ error: 'muito_rapido' }, { status: 429 }) // sem vazar corpo/detalhe
  }

  const body = (await request.json().catch(() => ({}))) as TakedownIntakeInput
  const parsed = normalizeTakedownIntake(body)
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  // Limitador persistido: IP (quando há) e depois o teto global. Erro de banco aqui ⇒ 500 genérico, como o INSERT.
  try {
    const rules: RateLimitRule[] = []
    if (ip) rules.push({ bucket: 'takedown_ip', key: limiterKey('takedown_ip', ipRateKey(ip)) })
    rules.push({ bucket: 'takedown_global', key: GLOBAL_LIMIT_KEY })
    const now = new Date()
    const decision = await consumeRateLimits(getDb(), rules, now)
    if (!decision.allowed) {
      if (decision.bucket === 'takedown_global') logGlobalTrip(now.getTime())
      return Response.json(
        { error: 'rate_limited', retryAfterMs: decision.retryAfterMs },
        { status: 429, headers: { 'retry-after': String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))) } },
      )
    }
  } catch {
    return Response.json({ error: 'erro' }, { status: 500 })
  }

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
