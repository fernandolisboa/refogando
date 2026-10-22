/**
 * Relato de erro do NAVEGADOR para `/api/client-errors` (issue #590, ADR-0048). Sem React, sem
 * `'use client'`, sem efeito no nível do módulo (o `global-error` é pré-renderizado no build e importa
 * daqui): `window`/`sessionStorage`/`fetch` só são tocados dentro das funções.
 *
 * Quem chama:
 *  - as error boundaries (`src/app/[locale]/error.tsx` ⇒ `boundary`, `src/app/global-error.tsx` ⇒ `global`):
 *    erro pego por boundary explícito NÃO vira evento de janela, então a boundary relata;
 *  - os listeners de janela de `src/instrumentation-client.ts` (antes da hidratação): erro não pego
 *    (`janela`), rejeição sem `catch` (`promessa`) e os recuperáveis do React, que o Next manda para
 *    `window.reportError` (`hidratacao` quando a mensagem casa `HYDRATION_ERROR_RE`).
 *
 * Contrato: NUNCA lança e NUNCA escreve no console (o guarda de console do E2E reprova, e um relato que
 * gera log gera relato). Só liga em produção. Tetos: 5 por carga, 20 por sessão, dedup por impressão
 * digital. Envio por `fetch` com `keepalive` (sobrevive à navegação), `credentials: 'omit'` (sem cookie de
 * sessão) e `referrerPolicy: 'no-referrer'` — o `Referer` same-origin levaria a URL INTEIRA, com query
 * (next.config.ts). `sendBeacon` não serve: não controla o referrer. Navegador sem `keepalive` ignora a
 * opção e manda um fetch comum.
 */
import {
  CLIENT_ERROR_LIMITS,
  HYDRATION_ERROR_RE,
  buildClientErrorReport,
  clientErrorFingerprint,
  type ClientErrorKind,
} from '@/domain/error-report'
import { isChunkLoadError } from '@/lib/app-update-reload'

export const CLIENT_ERRORS_ENDPOINT = '/api/client-errors'
const SESSION_KEY = 'erro-relatos'

type CountStorage = Pick<Storage, 'getItem' | 'setItem'>

export type ClientErrorReportOptions = {
  /** Liga/desliga; default: só em `NODE_ENV === 'production'`. */
  enabled?: boolean
  /** Transporte (corpo JSON já serializado). Default: `fetch` keepalive. */
  send?: (body: string) => void
  /** Contador da sessão. Default: `window.sessionStorage`; `null` = só memória. */
  storage?: CountStorage | null
  /** Pathname a normalizar. Default: `window.location.pathname`. */
  pathname?: string
}

// Estado da CARGA da página (o módulo vive enquanto a aba não recarrega). Variável simples, sem tocar window.
const seen = new Set<string>()
let sentThisLoad = 0
let sentThisSessionInMemory = 0

/** Só para testes: zera o estado da carga. */
export function resetClientErrorReportState(): void {
  seen.clear()
  sentThisLoad = 0
  sentThisSessionInMemory = 0
}

function defaultEnabled(): boolean {
  return process.env.NODE_ENV === 'production'
}

function defaultStorage(): CountStorage | null {
  try {
    return window.sessionStorage
  } catch {
    return null // Safari privado / storage bloqueado
  }
}

function defaultSend(body: string): void {
  if (typeof fetch !== 'function') return
  void fetch(CLIENT_ERRORS_ENDPOINT, {
    method: 'POST',
    keepalive: true,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    body,
  }).catch(() => {})
}

// Erro de chunk velho pós-deploy é atualização, não bug (D5): a boundary/o guard recarregam. O Turbopack
// joga `Failed to load chunk …` (com `name = 'ChunkLoadError'`, que some ao atravessar serialização).
function isChunkError(err: unknown, message: string): boolean {
  return isChunkLoadError(err, message) || /Failed to load chunk/i.test(message)
}

function readSessionCount(storage: CountStorage | null): number {
  if (!storage) return sentThisSessionInMemory
  try {
    const n = Number(storage.getItem(SESSION_KEY) ?? '0')
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return sentThisSessionInMemory
  }
}

function writeSessionCount(storage: CountStorage | null, n: number): void {
  sentThisSessionInMemory = n
  if (!storage) return
  try {
    storage.setItem(SESSION_KEY, String(n))
  } catch {
    // storage cheio/bloqueado: fica o contador em memória.
  }
}

/**
 * Relata um erro. Devolve `true` se mandou. Desligado, ruído de chunk, duplicado ou acima dos tetos ⇒
 * `false`, sem efeito. A mensagem já sai sanitizada daqui (e o servidor sanitiza de novo).
 */
export function reportClientError(
  tipo: ClientErrorKind,
  err: unknown,
  opts: ClientErrorReportOptions & { message?: string } = {},
): boolean {
  try {
    if (!(opts.enabled ?? defaultEnabled())) return false
    const rawMessage = messageOf(err, opts.message)
    if (isChunkError(err, rawMessage)) return false
    const pathname = opts.pathname ?? window.location.pathname
    const report = buildClientErrorReport(tipo, err, pathname, rawMessage)
    const fp = clientErrorFingerprint(report)
    if (seen.has(fp)) return false
    if (sentThisLoad >= CLIENT_ERROR_LIMITS.perPageLoad) return false
    const storage = opts.storage === undefined ? defaultStorage() : opts.storage
    const sessionCount = readSessionCount(storage)
    if (sessionCount >= CLIENT_ERROR_LIMITS.perSession) return false
    seen.add(fp)
    sentThisLoad += 1
    writeSessionCount(storage, sessionCount + 1)
    ;(opts.send ?? defaultSend)(JSON.stringify(report))
    return true
  } catch {
    return false
  }
}

function messageOf(err: unknown, explicit?: string): string {
  if (typeof explicit === 'string') return explicit
  if (typeof err === 'string') return err
  const m = (err as { message?: unknown } | null)?.message
  return typeof m === 'string' ? m : ''
}

// Ruído que não é bug nosso: rede caindo (cada navegador escreve de um jeito), abort de fetch, o loop do
// ResizeObserver (benigno) e o "Script error." opaco de script de outra origem.
const NETWORK_NOISE_RE = /Failed to fetch|NetworkError|Load failed|network connection was lost/i
const RESIZE_OBSERVER_RE = /ResizeObserver loop/i

function stackOf(err: unknown): string {
  const s = (err as { stack?: unknown } | null)?.stack
  return typeof s === 'string' ? s.slice(0, 4000) : ''
}

/** `true` quando o erro é ruído e não deve ser relatado. Exportado para teste. */
export function isClientErrorNoise(err: unknown, message: string, filename: string | undefined, origin: string): boolean {
  if (message === 'Script error.' || message === 'Script error') return true
  if (filename) {
    try {
      if (new URL(filename, origin).origin !== origin) return true // script de terceiro / extensão
    } catch {
      return true
    }
  }
  if (/-extension:\/\//.test(stackOf(err))) return true
  if (RESIZE_OBSERVER_RE.test(message)) return true
  if (isChunkError(err, message)) return true
  if ((err as { name?: unknown } | null)?.name === 'AbortError') return true
  if (NETWORK_NOISE_RE.test(message)) return true
  return false
}

/**
 * Instala os listeners de janela (chamado por `src/instrumentation-client.ts`). Devolve a função que os
 * remove. Desligado (fora de produção) ⇒ não instala nada. `error` SEM capture: falha de carga de recurso
 * (<img>, <script>) não borbulha e não interessa aqui; erro de script jogado chega como `ErrorEvent`.
 */
export function installClientErrorListeners(win: Window, opts: ClientErrorReportOptions = {}): () => void {
  if (!(opts.enabled ?? defaultEnabled())) return () => {}
  const origin = win.location.origin
  const onError = (e: Event) => {
    try {
      const ev = e as Partial<ErrorEvent>
      if (typeof ev.message !== 'string' && ev.error === undefined) return // não é ErrorEvent
      // A mensagem do próprio erro antes da do evento (o evento prefixa "Uncaught …"); sem erro (script de
      // outra origem, "Script error."), fica a do evento.
      const message = messageOf(ev.error) || (typeof ev.message === 'string' ? ev.message : '')
      const err: unknown = ev.error ?? { name: 'Error', message }
      if (isClientErrorNoise(err, message, ev.filename, origin)) return
      const tipo: ClientErrorKind = HYDRATION_ERROR_RE.test(message) ? 'hidratacao' : 'janela'
      reportClientError(tipo, err, { ...opts, message })
    } catch {
      // nunca propaga
    }
  }
  const onRejection = (e: Event) => {
    try {
      // Duck typing (sem `instanceof PromiseRejectionEvent`: o jsdom e navegadores antigos variam).
      const reason: unknown = (e as { reason?: unknown }).reason
      const message = messageOf(reason)
      if (isClientErrorNoise(reason, message, undefined, origin)) return
      reportClientError('promessa', reason, { ...opts, message })
    } catch {
      // nunca propaga
    }
  }
  win.addEventListener('error', onError)
  win.addEventListener('unhandledrejection', onRejection)
  return () => {
    win.removeEventListener('error', onError)
    win.removeEventListener('unhandledrejection', onRejection)
  }
}
