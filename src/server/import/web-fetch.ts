/**
 * Helpers de REDE compartilhados pela importação de receita (#165, #272) e pelo probe de saúde (#273).
 *
 * Aloja: (1) constantes de fetch + o fetch do robots.txt (`robotsAllows`, BYTE-IDÊNTICO entre importer e
 * probe); (2) o fetch ENDURECIDO da PÁGINA (`fetchHardenedHtml`), a MESMA defesa de SSRF antes usada só
 * pelo probe — agora compartilhada com o importer (#448). Ambos passam pela MESMA barreira: DNS resolvido
 * ANTES de conectar (rejeita privado ⇒ anti-rebind), `redirect:'manual'` com follow LIMITADO (≤3 hops)
 * RE-VALIDADO por hop, streaming com corte em `MAX_HTML_BYTES` e `AbortSignal` de timeout.
 *
 * `robotsAllows` é FAIL-OPEN deliberado (≠ o fail-CLOSED da allowlist): robots indisponível ⇒ permitido.
 * Só uma proibição EXPLÍCITA bloqueia. NÃO é exercitado por teste real (rede) — os testes injetam `fetch`.
 */
import { lookup } from 'node:dns/promises'
import { isPathAllowedByRobots } from '@/domain/robots-txt'
import { parseProbeUrl, isBlockedAddress } from '@/server/import/probe-url'

/** User-Agent explícito: alguns sites bloqueiam clientes sem UA. Identifica o bot honestamente. */
export const IMPORT_USER_AGENT = 'RefogandoBot/1.0 (+recipe-import)'

/** Product token do nosso UA (a parte antes da `/`) — é por ele que um grupo do robots.txt nos endereça. */
export const ROBOTS_UA_TOKEN = 'RefogandoBot'

/** Teto do corpo HTML baixado (defesa contra páginas gigantescas / abuso de memória). */
export const MAX_HTML_BYTES = 2 * 1024 * 1024

/** robots.txt é pequeno; cap defensivo bem abaixo do HTML. */
export const MAX_ROBOTS_BYTES = 512 * 1024

/** Timeout curto do robots.txt — indisponível ⇒ permitido (fail-open). */
export const ROBOTS_TIMEOUT_MS = 3000

/**
 * `true` se o robots.txt da MESMA origem da `url` permite buscarmos esse path (RFC 9309, avaliado pelo
 * domínio puro `isPathAllowedByRobots`). FAIL-OPEN: qualquer falha de obter/avaliar o robots.txt — 4xx/
 * 404, 5xx, timeout, erro de rede, redirect — devolve `true` (permitido). Defesas: `redirect:'manual'`
 * (um 3xx do /robots.txt NÃO leva o fetch a um host arbitrário — fecha o flanco de SSRF), timeout curto e
 * corpo capado. NUNCA lança.
 */
export async function robotsAllows(url: string, uaToken: string = ROBOTS_UA_TOKEN): Promise<boolean> {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return true // URL inválida: não bloqueamos por robots (o fetch da página tratará o erro)
  }
  // UM timer cobre fetch + leitura do corpo (signal aborta ambos); a avaliação roda DENTRO do try
  // (o matcher é linear e total, mas o try honra literalmente o fail-open-on-evaluate do docstring).
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ROBOTS_TIMEOUT_MS)
  try {
    const res = await fetch(`${target.origin}/robots.txt`, {
      headers: { 'user-agent': IMPORT_USER_AGENT, accept: 'text/plain' },
      redirect: 'manual', // NÃO perseguir 3xx p/ outro host (SSRF) — trata como indisponível
      signal: controller.signal,
    })
    if (!res.ok) return true // 404/4xx (sem regras), 5xx, ou 3xx opaco (manual) ⇒ permitido
    // Dica de tamanho: um robots.txt absurdo é tratado como indisponível (não bufferiza GB na memória).
    const declared = Number(res.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_ROBOTS_BYTES) return true
    const raw = await res.text()
    const robotsTxt = raw.length > MAX_ROBOTS_BYTES ? raw.slice(0, MAX_ROBOTS_BYTES) : raw
    return isPathAllowedByRobots(robotsTxt, uaToken, target.pathname + target.search)
  } catch {
    return true // timeout/abort/erro de rede/avaliação ⇒ permitido (FAIL-OPEN)
  } finally {
    clearTimeout(timer)
  }
}

// ── Fetch ENDURECIDO da página (SSRF pós-redirect / DNS-rebind / DoS) — #448, #273 ──────────────────

/** Timeout por hop do fetch da página — abortado via `AbortSignal`. */
export const PAGE_TIMEOUT_MS = 5000

/** Teto de redirects seguidos: cada `Location` é RE-VALIDADO (parseProbeUrl + DNS) antes do próximo hop. */
export const MAX_REDIRECTS = 3

/** Resolvedor DNS injetável (default `node:dns/promises.lookup`, `all:true`) — testes injetam endereços fixos. */
export type AddressLookup = (hostname: string) => Promise<string[]>

/** Página buscada com sucesso: HTML (possivelmente truncado no cap) + a URL FINAL (pós-redirects), p/ o parse. */
export interface FetchedPage {
  html: string
  finalUrl: string
}

const defaultLookup: AddressLookup = async (hostname) => {
  const res = await lookup(hostname, { all: true })
  return res.map((r) => r.address)
}

/** Hostname normalizado (lowercase, sem `[]`, sem ponto final) de uma URL, ou `null` se inválida. */
export function hostnameOf(url: string): string | null {
  try {
    let h = new URL(url).hostname.toLowerCase()
    if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
    if (h.endsWith('.')) h = h.slice(0, -1)
    return h === '' ? null : h
  } catch {
    return null
  }
}

/**
 * `true` se o `host` resolve por DNS e NENHUM endereço é privado/loopback/link-local (defesa contra
 * DNS-rebind). Zero endereços ou erro de resolução ⇒ `false` (bloqueado). Reusado pelo probe na checagem
 * de ORIGEM antes do robots.txt.
 */
export async function isHostPublic(host: string, lookupFn: AddressLookup = defaultLookup): Promise<boolean> {
  try {
    const addrs = await lookupFn(host)
    if (addrs.length === 0) return false
    return addrs.every((a) => !isBlockedAddress(a))
  } catch {
    return false
  }
}

/**
 * Lê o corpo da resposta com cap por streaming. No ESTOURO do cap, NÃO descarta tudo: trunca em
 * `MAX_HTML_BYTES` e devolve o prefixo — o JSON-LD vive no `<head>`, antes do corte, então o parse casa.
 * Só um ERRO de leitura no meio do stream (≠ estouro de cap) ⇒ `null` (tratado como não-buscável).
 */
async function readCappedHtml(res: Response): Promise<string | null> {
  const body = res.body
  if (!body) {
    // Sem stream (alguns ambientes/mocks): cai no text() com corte.
    const raw = await res.text()
    return raw.length > MAX_HTML_BYTES ? raw.slice(0, MAX_HTML_BYTES) : raw
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        const remaining = MAX_HTML_BYTES - total
        if (value.byteLength >= remaining) {
          // Estourou o cap: guarda só o prefixo até MAX_HTML_BYTES, cancela o resto e PARA (parseia o que
          // tem — não retorna null).
          chunks.push(value.subarray(0, remaining))
          total += remaining
          await reader.cancel().catch(() => {})
          break
        }
        total += value.byteLength
        chunks.push(value)
      }
    }
  } catch {
    return null // erro de leitura no meio do stream (≠ estouro de cap) ⇒ não-buscável
  }
  const buf = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    buf.set(c, off)
    off += c.byteLength
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf)
}

/**
 * Busca a página de `startUrl` com a defesa ENDURECIDA de SSRF (#448) — a MESMA barreira antes exclusiva
 * do probe (#273), agora compartilhada com o importer. Por hop: (1) re-valida a URL (`parseProbeUrl`:
 * só http(s), rejeita IP-literal privado/hostname interno, zera userinfo); (2) resolve o DNS e rejeita se
 * QUALQUER endereço for privado (`isHostPublic` — anti-rebind); (3) `redirect:'manual'` p/ interceptar o
 * `Location` e re-checá-lo, seguindo no MÁXIMO `MAX_REDIRECTS` hops; (4) `AbortSignal` de timeout; (5)
 * corpo lido por streaming com corte em `MAX_HTML_BYTES` (Content-Length declarado > cap ⇒ recusa direto).
 *
 * Non-2xx, redirect sem/para host inválido-ou-privado, excesso de hops, erro de leitura ou QUALQUER
 * exceção (timeout/DNS/TLS/rede) ⇒ `null`. NUNCA lança — o chamador mapeia `null` ao seu erro tratado.
 */
export async function fetchHardenedHtml(
  startUrl: string,
  lookupFn: AddressLookup = defaultLookup,
): Promise<FetchedPage | null> {
  let currentUrl = parseProbeUrl(startUrl)
  if (currentUrl === null) return null

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const host = hostnameOf(currentUrl)
    if (host === null) return null
    if (!(await isHostPublic(host, lookupFn))) return null

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS)
    try {
      const res = await fetch(currentUrl, {
        headers: { 'user-agent': IMPORT_USER_AGENT, accept: 'text/html,application/xhtml+xml' },
        redirect: 'manual',
        signal: controller.signal,
      })
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) return null
        let resolved: string
        try {
          resolved = new URL(loc, currentUrl).toString()
        } catch {
          return null
        }
        const next = parseProbeUrl(resolved)
        if (next === null) return null // redirect p/ host privado/esquema inválido ⇒ não-buscável
        currentUrl = next
        continue
      }
      if (!res.ok) return null
      const declared = Number(res.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > MAX_HTML_BYTES) return null
      const html = await readCappedHtml(res)
      if (html === null) return null
      return { html, finalUrl: currentUrl }
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }
  return null // excesso de redirects
}
