import { isLoopbackUrl } from './mode'

/**
 * Guarda de SAÍDA do servidor no modo fake do E2E (#589): embrulha `globalThis.fetch` e RECUSA (com log)
 * qualquer requisição http(s) fora de loopback. Os dublês de `./fakes.ts` já não tocam a rede; isto pega
 * o caminho que escapou (um provedor novo sem dublê, um `fetch` cru numa rota) — o E2E falha alto em vez
 * de chamar a Anthropic/Gemini/Resend de verdade.
 *
 * Cobre todo `fetch` global, inclusive com `init.dispatcher` do undici: o fetch endurecido do importador
 * (`src/server/import/web-fetch.ts`) usa o `fetch` GLOBAL com um `Agent` pinado, então passa por aqui.
 * Lá, `robotsAllows` engole a rejeição (fail-open de propósito: robots indisponível ⇒ permitido), então
 * o sinal desse caminho é só o log abaixo; o fetch da página propaga o erro normalmente.
 *
 * LIMITE CONHECIDO: cliente que fala `undici`/`http` direto passa por fora. A única exceção conhecida é o
 * SDK do `@vercel/blob` (importa o `undici` dele), e esse seam já está trocado por dublê no modo fake.
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
