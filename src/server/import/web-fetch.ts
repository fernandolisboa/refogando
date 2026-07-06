/**
 * Helpers de REDE compartilhados pela importação de receita (#165, #272) e pelo probe de saúde (#273).
 *
 * Aloja: (1) constantes de fetch + o fetch do robots.txt (`robotsAllows`, BYTE-IDÊNTICO entre importer e
 * probe); (2) o fetch ENDURECIDO da PÁGINA (`fetchHardenedHtml`), a MESMA defesa de SSRF antes usada só
 * pelo probe — agora compartilhada com o importer (#448).
 *
 * ANTI-REBIND POR IP PINADO (fecha o resíduo TOCTOU do #448): resolver o DNS e DEPOIS deixar o `fetch`
 * re-resolver o hostname por conta própria abriria uma janela de rebind (TTL=0 devolve IP público na
 * checagem e privado — ex.: 169.254.169.254 — no connect). Aqui o host é resolvido UMA vez, os IPs
 * validados são PINADOS num `Agent` do undici (`connect.lookup` custom que devolve o IP já validado em vez
 * de re-resolver), e o `fetch` conecta NAQUELE IP. O `Host` header e o `servername` (SNI TLS) continuam o
 * hostname ORIGINAL (o undici só troca o alvo do socket, não a URL), então HTTPS/vhosts não quebram.
 * Defesa dupla: o IP pinado é RE-CHECADO com `isBlockedAddress` no momento do connect. A MESMA pinagem
 * cobre o fetch da PÁGINA e o do `/robots.txt`. Somado: `redirect:'manual'` com follow LIMITADO (≤3 hops)
 * RE-VALIDADO por hop, streaming com corte em `MAX_HTML_BYTES` e `AbortSignal` de timeout.
 *
 * `robotsAllows` é FAIL-OPEN deliberado (≠ o fail-CLOSED da allowlist): robots indisponível ⇒ permitido.
 * Só uma proibição EXPLÍCITA bloqueia. NÃO é exercitado por teste real (rede) — os testes injetam `fetch`.
 */
import { lookup } from 'node:dns/promises'
import { isIP, type LookupFunction } from 'node:net'
import { Agent, type Dispatcher } from 'undici'
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
 * 404, 5xx, timeout, erro de rede, redirect, origem privada/irresolúvel — devolve `true` (permitido).
 * Defesas: IP PINADO no connect (mesma resolução única do fetch da página — anti-rebind, fecha o flanco
 * TOCTOU do próprio GET do robots.txt), `redirect:'manual'` (um 3xx do /robots.txt NÃO leva o fetch a um
 * host arbitrário), timeout curto e corpo capado. NUNCA lança.
 */
export async function robotsAllows(
  url: string,
  uaToken: string = ROBOTS_UA_TOKEN,
  lookupFn: AddressLookup = defaultLookup,
): Promise<boolean> {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return true // URL inválida: não bloqueamos por robots (o fetch da página tratará o erro)
  }
  // Resolve a origem UMA vez e pina o IP no connect (anti-rebind). Origem privada/irresolúvel ⇒ NÃO
  // buscamos o robots.txt e caímos no fail-open (`true`); o fetch da página, pinado igual, é quem bloqueia.
  const host = hostnameOf(url)
  const addrs = host === null ? null : await resolvePublicAddrs(host, lookupFn)
  if (addrs === null) return true
  const dispatcher = pinnedDispatcher(addrs)
  // UM timer cobre fetch + leitura do corpo (signal aborta ambos); a avaliação roda DENTRO do try
  // (o matcher é linear e total, mas o try honra literalmente o fail-open-on-evaluate do docstring).
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ROBOTS_TIMEOUT_MS)
  const init: FetchInit = {
    headers: { 'user-agent': IMPORT_USER_AGENT, accept: 'text/plain' },
    redirect: 'manual', // NÃO perseguir 3xx p/ outro host (SSRF) — trata como indisponível
    signal: controller.signal,
    dispatcher,
  }
  try {
    const res = await fetch(`${target.origin}/robots.txt`, init)
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
    await dispatcher.destroy().catch(() => {})
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
  return (await resolvePublicAddrs(host, lookupFn)) !== null
}

/**
 * Resolve o `host` UMA vez e devolve os endereços SE todos forem públicos — ou `null` (zero endereços,
 * erro de resolução, ou QUALQUER endereço privado/loopback/link-local). É a resolução única cujos IPs
 * serão PINADOS no connect (elimina a 2ª resolução do `fetch`, a janela de rebind). PURO exceto o DNS.
 */
export async function resolvePublicAddrs(
  host: string,
  lookupFn: AddressLookup = defaultLookup,
): Promise<string[] | null> {
  try {
    const addrs = await lookupFn(host)
    if (addrs.length === 0) return null
    return addrs.every((a) => !isBlockedAddress(a)) ? addrs : null
  } catch {
    return null
  }
}

/**
 * `lookup` (assinatura de `dns.lookup`, o que o `Agent.connect` do undici chama) que IGNORA o hostname e
 * devolve SEMPRE os `addrs` JÁ VALIDADOS — assim a conexão vai ao IP checado, não a uma 2ª resolução
 * (potencialmente maliciosa). DEFESA DUPLA: re-checa cada IP com `isBlockedAddress` na hora do connect; se
 * nenhum sobreviver, ERRA (nenhum socket abre). Honra `options.all` (o `net` do Node pode pedir a lista —
 * ex.: `autoSelectFamily`) devolvendo `[{address,family}]`; senão devolve `(address, family)`.
 */
export function pinnedLookup(addrs: string[]): LookupFunction {
  return (_hostname, options, callback) => {
    const safe = addrs.filter((a) => !isBlockedAddress(a))
    if (safe.length === 0) {
      callback(new Error('endereço pinado bloqueado (rebind)'), '', undefined)
      return
    }
    const entries = safe.map((a) => ({ address: a, family: isIP(a) === 6 ? 6 : 4 }))
    if (options?.all) {
      callback(null, entries)
    } else {
      callback(null, entries[0].address, entries[0].family)
    }
  }
}

/**
 * `Agent` do undici que conecta AOS `addrs` pinados (via `connect.lookup`), preservando `Host`/`servername`
 * = hostname original (o undici não reescreve a URL — só o alvo do socket). Um dispatcher por fetch; o
 * chamador o DESTRÓI no `finally` após consumir o corpo. Passado ao `fetch` global via `init.dispatcher`
 * (checagem por duck-typing de `.dispatch`); nos testes o `fetch` mockado o ignora sem efeito.
 */
export function pinnedDispatcher(addrs: string[]): Dispatcher {
  return new Agent({ connect: { lookup: pinnedLookup(addrs) } })
}

/** `RequestInit` + a extensão `dispatcher` do undici (ausente do lib.dom) — evita cast solto no call-site. */
type FetchInit = RequestInit & { dispatcher?: Dispatcher }

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
 * só http(s), rejeita IP-literal privado/hostname interno, zera userinfo); (2) resolve o DNS UMA vez e
 * rejeita se QUALQUER endereço for privado, depois PINA os IPs validados no connect (`pinnedDispatcher`) —
 * o `fetch` NÃO re-resolve o hostname, então não há janela de rebind entre a checagem e a conexão; o `Host`
 * e o `servername` TLS continuam o hostname original; (3) `redirect:'manual'` p/ interceptar o `Location`
 * e re-checá-lo, seguindo no MÁXIMO `MAX_REDIRECTS` hops; (4) `AbortSignal` de timeout; (5) corpo lido por
 * streaming com corte em `MAX_HTML_BYTES` (Content-Length declarado > cap ⇒ recusa direto).
 *
 * Non-2xx, redirect sem/para host inválido-ou-privado, excesso de hops, erro de leitura ou QUALQUER
 * exceção (timeout/DNS/TLS/rede) ⇒ `null`. NUNCA lança — o chamador mapeia `null` ao seu erro tratado.
 *
 * `isHopAllowed` (opcional) é RE-CHECADO em CADA hop — inclusive o alvo de um redirect. O importer passa
 * a checagem de allowlist (`isUrlAllowed`) por aqui: assim um domínio curado que devolva 302 p/ um host
 * público FORA da allowlist é recusado (fecha o open-redirect → host arbitrário, #448/#164). O probe NÃO
 * passa nada (é admin-arbitrário, PRÉ-allowlist — sua barreira é só SSRF/DNS).
 */
export async function fetchHardenedHtml(
  startUrl: string,
  lookupFn: AddressLookup = defaultLookup,
  isHopAllowed?: (url: string) => boolean,
): Promise<FetchedPage | null> {
  let currentUrl = parseProbeUrl(startUrl)
  if (currentUrl === null) return null

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (isHopAllowed && !isHopAllowed(currentUrl)) return null // fora da allowlist (origem OU alvo de redirect)
    const host = hostnameOf(currentUrl)
    if (host === null) return null
    // Resolve UMA vez e PINA os IPs no connect (anti-rebind): o `fetch` conecta ao IP já validado em vez
    // de re-resolver o hostname. Zero endereços / qualquer privado ⇒ `null` (nenhum socket abre).
    const addrs = await resolvePublicAddrs(host, lookupFn)
    if (addrs === null) return null
    const dispatcher = pinnedDispatcher(addrs)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS)
    const init: FetchInit = {
      headers: { 'user-agent': IMPORT_USER_AGENT, accept: 'text/html,application/xhtml+xml' },
      redirect: 'manual',
      signal: controller.signal,
      dispatcher,
    }
    try {
      const res = await fetch(currentUrl, init)
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
      await dispatcher.destroy().catch(() => {})
    }
  }
  return null // excesso de redirects
}
