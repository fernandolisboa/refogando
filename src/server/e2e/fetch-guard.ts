import { isLoopbackUrl } from './mode'

/**
 * Guarda de SAÍDA do servidor no modo fake do E2E (#589): embrulha `globalThis.fetch` e RECUSA (com log)
 * qualquer requisição http(s) fora de loopback. Os dublês de `./fakes.ts` já não tocam a rede; isto pega
 * o caminho que escapou (um provedor novo sem dublê, um `fetch` cru numa rota) — o E2E falha alto em vez
 * de chamar a Anthropic/Gemini/Resend de verdade.
 *
 * LIMITE CONHECIDO: só cobre o `fetch` global. Cliente que fala `undici`/`http` direto (o SDK do Vercel
 * Blob, o fetch endurecido do importador em `web-fetch.ts`) passa por fora — esses seams já estão
 * trocados por dublês no modo fake, então não chegam a rodar.
 */
export function installLoopbackFetchGuard(): void {
  const original = globalThis.fetch
  if ((original as { __e2eGuard?: boolean }).__e2eGuard) return
  const guarded: typeof fetch = (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    let protocol = ''
    try {
      protocol = new URL(raw).protocol
    } catch {
      // URL relativa/inválida: o próprio fetch rejeita adiante.
    }
    if ((protocol === 'http:' || protocol === 'https:') && !isLoopbackUrl(raw)) {
      const host = (() => {
        try {
          return new URL(raw).host
        } catch {
          return '?'
        }
      })()
      console.error(`[e2e] fetch RECUSADO para fora de loopback: ${host}`)
      return Promise.reject(new TypeError(`[e2e] fetch recusado para ${host} (modo fake: só loopback)`))
    }
    return original(input, init)
  }
  Object.assign(guarded, { __e2eGuard: true })
  globalThis.fetch = guarded
}
