import {
  CLIENT_ERROR_LIMITS,
  CLIENT_ERROR_LIMIT_LINE,
  formatClientErrorLine,
  parseClientErrorReport,
} from '@/domain/error-report'
import { clientIpFromHeaders } from '@/server/http/params'
import { createDomainRateLimiter } from '@/server/import/rate-limit'

/**
 * Intake PÚBLICO dos relatos de erro do navegador (`POST /api/client-errors`, issue #590, ADR-0048). Fábrica
 * fora do `route.ts` porque o route handler do Next não aceita export arbitrário: o teste monta uma com
 * relógio e teto próprios.
 *
 * Sem sessão, sem banco: o único efeito é UMA linha `[erro] origem=cliente …` no log (`console.warn`). O
 * corpo não é confiável — `parseClientErrorReport` re-sanitiza tudo. Ordem, do mais barato ao mais caro:
 *  1. `Sec-Fetch-Site` presente e ≠ `same-origin` ⇒ 204 sem log (outro site não escreve no nosso log; o
 *     relato legítimo sai da própria página). Ausente (cliente sem o header) passa.
 *  2. ~1 relato/s por IP (`createDomainRateLimiter`, best-effort por instância). Sem IP ⇒ pula este passo.
 *  3. Teto da instância: 60 linhas/min somando todos. Estourou ⇒ 429 e UMA linha `limite=atingido` por janela.
 *  4. `content-length` > 2 KB ⇒ 413; e a leitura do corpo aborta ao passar de 2 KB (cobre chunked).
 *  5. JSON inválido ou fora do schema ⇒ 400.
 * Nunca 500: qualquer falha inesperada vira 400 sem detalhe.
 */

export type ClientErrorIntakeOptions = {
  now?: () => number
  perIpIntervalMs?: number
  perInstancePerMinute?: number
  bodyMaxBytes?: number
  /** Saída da linha. Default `console.warn`. */
  log?: (line: string) => void
}

const WINDOW_MS = 60_000

function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
}

function rateLimited(): Response {
  return Response.json({ error: 'rate_limited' }, { status: 429 }) // como o takedown: sem detalhe
}

function invalid(): Response {
  return Response.json({ error: 'invalido' }, { status: 400 })
}

/** Lê o corpo UMA vez, com teto em bytes. `null` = sem corpo; `'too_large'` = passou do teto. */
async function readBodyCapped(request: Request, max: number): Promise<string | null | 'too_large'> {
  const body = request.body
  if (!body) return null
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      return 'too_large'
    }
    chunks.push(value)
  }
  const buf = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    buf.set(c, offset)
    offset += c.byteLength
  }
  return new TextDecoder().decode(buf)
}

export function createClientErrorIntake(opts: ClientErrorIntakeOptions = {}): (request: Request) => Promise<Response> {
  const now = opts.now ?? (() => Date.now())
  const perInstance = opts.perInstancePerMinute ?? CLIENT_ERROR_LIMITS.perInstancePerMinute
  const bodyMax = opts.bodyMaxBytes ?? CLIENT_ERROR_LIMITS.bodyMaxBytes
  const log = opts.log ?? ((line: string) => console.warn(line))
  const perIp = createDomainRateLimiter({
    minIntervalMs: opts.perIpIntervalMs ?? CLIENT_ERROR_LIMITS.perIpIntervalMs,
    now,
  })
  // Janela fixa de 1 min por instância (estado em memória, como o limitador por IP).
  let windowStart = Number.NEGATIVE_INFINITY
  let windowCount = 0
  let limitLogged = false

  return async function intake(request: Request): Promise<Response> {
    try {
      const site = request.headers.get('sec-fetch-site')
      if (site && site !== 'same-origin') return noContent()

      const ip = clientIpFromHeaders(request)
      if (ip && !perIp.tryAcquire(ip)) return rateLimited()

      const t = now()
      if (t - windowStart >= WINDOW_MS) {
        windowStart = t
        windowCount = 0
        limitLogged = false
      }
      if (windowCount >= perInstance) {
        if (!limitLogged) {
          limitLogged = true
          log(CLIENT_ERROR_LIMIT_LINE)
        }
        return rateLimited()
      }
      windowCount += 1

      const declared = Number(request.headers.get('content-length') ?? '0')
      if (Number.isFinite(declared) && declared > bodyMax) return new Response(null, { status: 413 })
      const text = await readBodyCapped(request, bodyMax)
      if (text === 'too_large') return new Response(null, { status: 413 })
      if (text === null) return invalid()

      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        return invalid()
      }
      const parsed = parseClientErrorReport(raw)
      if (!parsed.ok) return invalid()

      log(formatClientErrorLine(parsed.value))
      return noContent()
    } catch {
      return invalid()
    }
  }
}
