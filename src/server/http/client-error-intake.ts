import {
  CLIENT_ERROR_LIMITS,
  CLIENT_ERROR_LIMIT_LINE,
  formatClientErrorLine,
  parseClientErrorReport,
} from '@/domain/error-report'
import { createIpBurstLimiter, ipRateKey } from '@/server/http/ip-burst-limit'
import { clientIpFromHeaders } from '@/server/http/params'
import { RATE_LIMITS, windowStartOf } from '@/domain/rate-limit-rules'

/**
 * Intake PÚBLICO dos relatos de erro do navegador (`POST /api/client-errors`, issue #590, ADR-0048). Fábrica
 * fora do `route.ts` porque o route handler do Next não aceita export arbitrário: o teste monta uma com
 * relógio e teto próprios.
 *
 * Sem sessão; do banco, só o teto global (passo 6). O único efeito é UMA linha `[erro] origem=cliente …` no log
 * (`console.warn`). O corpo não é confiável — `parseClientErrorReport` re-sanitiza tudo. Ordem, do mais barato
 * ao mais caro:
 *  1. `Sec-Fetch-Site` presente e ≠ `same-origin` ⇒ 204 sem log (outro site não escreve no nosso log; o
 *     relato legítimo sai da própria página). Ausente (cliente sem o header) passa.
 *  2. Rajada por IP (IPv6 pela /64): 5 requests a cada 10 s (`createIpBurstLimiter`, best-effort por
 *     instância). Sem IP ⇒ pula este passo.
 *  3. Teto da instância: 60 LINHAS/min somando todos. Estourou ⇒ 429 e UMA linha `limite=atingido` por
 *     janela. Conta só a linha escrita: request de lixo (400/413) não gasta o teto.
 *  4. `content-length` > 2 KB ⇒ 413; e a leitura do corpo aborta ao passar de 2 KB (cobre chunked).
 *  5. JSON inválido ou fora do schema ⇒ 400 `{ error: 'dados_invalidos' }`.
 *  6. #648 (ADR-0057): teto GLOBAL persistido (`globalCap`, o route passa o do banco): linhas por minuto somando
 *     todas as instâncias, porque o teto da instância some num laço espalhado por muitas. A chave é só 'global' —
 *     o IP continua só em memória (política item 3.7). Estourou ⇒ 429; o banco falhou ou demorou mais que
 *     `globalCapTimeoutMs` ⇒ segue (fail-open: os tetos em memória continuam valendo e o relato de erro não pode
 *     depender do banco estar de pé).
 *     A vaga da instância é RESERVADA antes do `await` (senão os concorrentes passariam todos pelo check enquanto
 *     esperam o banco, furando o teto da instância) e devolvida se o global barrar. Teto global cheio fica guardado
 *     na instância até a virada da janela global: o resto do minuto responde 429 sem ir ao banco.
 * Nunca 500: qualquer falha inesperada vira 400 sem detalhe.
 */

export type ClientErrorIntakeOptions = {
  now?: () => number
  perIpBurst?: number
  perIpWindowMs?: number
  perInstancePerMinute?: number
  bodyMaxBytes?: number
  /** Saída da linha. Default `console.warn`. */
  log?: (line: string) => void
  /**
   * Teto global persistido: `true` = cabe (e conta). Lançar = fail-open. Ausente = sem teto global (os testes de
   * UI, sem banco). O route passa `consumeRateLimit` no bucket `client_error_global`.
   */
  globalCap?: () => Promise<boolean>
  /** Espera máxima pelo `globalCap`; passou ⇒ fail-open. Default 750 ms (o `connect_timeout` do banco é 30 s). */
  globalCapTimeoutMs?: number
  /** Janela do teto global, alinhada à época (default: a do bucket `client_error_global`). */
  globalWindowMs?: number
}

const WINDOW_MS = 60_000
const GLOBAL_CAP_TIMEOUT_MS = 750

function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
}

function rateLimited(): Response {
  return Response.json({ error: 'rate_limited' }, { status: 429 }) // como o takedown: sem detalhe
}

function invalid(): Response {
  return Response.json({ error: 'dados_invalidos' }, { status: 400 })
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
  const perIp = createIpBurstLimiter({
    max: opts.perIpBurst ?? CLIENT_ERROR_LIMITS.perIpBurst,
    windowMs: opts.perIpWindowMs ?? CLIENT_ERROR_LIMITS.perIpWindowMs,
    now,
  })
  // Janela fixa de 1 min por instância (estado em memória, como o limitador por IP). Conta LINHAS escritas.
  let windowStart = Number.NEGATIVE_INFINITY
  let windowCount = 0
  let limitLogged = false

  const globalCap = opts.globalCap
  const globalTimeoutMs = opts.globalCapTimeoutMs ?? GLOBAL_CAP_TIMEOUT_MS
  const globalWindowMs = opts.globalWindowMs ?? RATE_LIMITS.client_error_global.windowMs
  // Teto global já visto cheio: até quando (fim da janela global) a instância responde 429 sem consultar o banco.
  let globalFullUntil = Number.NEGATIVE_INFINITY

  /** Cabe no teto global? Cheio em cache ⇒ false sem banco; erro ou demora ⇒ true (fail-open). */
  async function globalFits(cap: () => Promise<boolean>): Promise<boolean> {
    if (now() < globalFullUntil) return false
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), globalTimeoutMs)
    })
    let fits: boolean
    try {
      fits = await Promise.race([Promise.resolve().then(cap).catch(() => true), timeout])
    } finally {
      clearTimeout(timer)
    }
    if (!fits) globalFullUntil = windowStartOf(now(), globalWindowMs) + globalWindowMs
    return fits
  }

  /** Teto da instância esgotado nesta janela? Na 1ª vez por janela escreve a linha `limite=atingido`. */
  function instanceFull(): boolean {
    const t = now()
    if (t - windowStart >= WINDOW_MS) {
      windowStart = t
      windowCount = 0
      limitLogged = false
    }
    if (windowCount < perInstance) return false
    if (!limitLogged) {
      limitLogged = true
      log(CLIENT_ERROR_LIMIT_LINE)
    }
    return true
  }

  return async function intake(request: Request): Promise<Response> {
    try {
      const site = request.headers.get('sec-fetch-site')
      if (site && site !== 'same-origin') return noContent()

      const ip = clientIpFromHeaders(request)
      if (ip && !perIp.tryAcquire(ipRateKey(ip))) return rateLimited()

      // Checa antes de ler o corpo (barato) e de novo antes de escrever: requests concorrentes passam juntos
      // pelo 1º check enquanto leem.
      if (instanceFull()) return rateLimited()

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

      if (instanceFull()) return rateLimited()
      // Reserva a vaga da instância ANTES de esperar o banco (doc do módulo, passo 6).
      windowCount += 1
      const reservedWindow = windowStart
      if (globalCap && !(await globalFits(globalCap))) {
        // Devolve a vaga, se a janela da instância ainda é a mesma (a virada já zerou o contador).
        if (windowStart === reservedWindow && windowCount > 0) windowCount -= 1
        return rateLimited()
      }
      log(formatClientErrorLine(parsed.value))
      return noContent()
    } catch {
      return invalid()
    }
  }
}
