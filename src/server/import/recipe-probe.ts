/**
 * Seam ÚNICO e mockável do PROBE de saúde de uma URL de receita (#273, ADR-0019).
 *
 * Espelha os outros seams (`recipe-importer.ts`, `embedder.ts`): interface + impl REAL + dublê FAKE no
 * MESMO arquivo, injetado via `getRecipeProbe()/setRecipeProbe()` em `deps.ts`. O probe é ASSISTIVO e
 * IDEMPOTENTE: NÃO persiste nada e NÃO toca a config (allowlist) — é só um check de uma URL ainda-NÃO-vetada
 * antes de o admin decidir adicioná-la. Reporta DOIS sinais — (a) a página tem schema.org/Recipe via
 * JSON-LD? (b) o robots.txt da origem permite o RefogandoBot nesse path? — mas avalia o robots PRIMEIRO e
 * só busca a página se ele PERMITIR (espelha o `RealRecipeImporter`, que devolve `robots_blocked` ANTES do
 * fetch); devolve um `ProbeReport` (derivação pura em `domain/web-search-probe.ts`).
 *
 * SEGURANÇA (SSRF) — o probe é o PRIMEIRO ponto onde URL admin-arbitrária chega ao `fetch` SEM a barreira
 * de allowlist. Defesas, nesta ordem: (1) `parseProbeUrl` (só http(s), rejeita IP privado/loopback/
 * link-local e hostnames internos — a rota já roda isto antes de chamar o seam); (2) resolução DNS de
 * TODOS os endereços ANTES de conectar, rejeitando qualquer privado (defesa contra DNS-rebind); (3) follow
 * de redirect LIMITADO (≤3 hops) e RE-VALIDADO por hop (parseProbeUrl + DNS); (4) timeout + cap por
 * streaming. NUNCA lança — todo erro vira `fetched:false` (veredito tratado).
 *
 * DESVIOS CONSCIENTES (registrados aqui, não silenciosos):
 *  - Rate-limiter de politeness (#272) PULADO de propósito: o probe é admin-only e MANUAL (uma URL por
 *    clique), não um crawler — não martela origem.
 *  - PIN-no-IP DEFERIDO (v2): resta um resíduo TOCTOU entre a resolução DNS e a conexão TCP (um host
 *    público que rebinde para privado entre os dois passos). Conectar pelo IP literal quebraria o SNI/cert
 *    TLS de https; proporcional aceitar o resíduo numa ferramenta admin-only manual (o importer aceita o
 *    mesmo). O veredito é booleano puro (não vaza topologia além do `fetched`, já contido pelo fechamento).
 */
import { lookup } from 'node:dns/promises'
import { parseImportedRecipe } from '@/domain/recipe-import-parse'
import { jsonLdSignal, type ProbeReport } from '@/domain/web-search-probe'
import { parseProbeUrl, isBlockedAddress } from '@/server/import/probe-url'
import { IMPORT_USER_AGENT, MAX_HTML_BYTES, ROBOTS_UA_TOKEN, robotsAllows } from '@/server/import/web-fetch'

export interface RecipeProbe {
  /** Checa a `url` (JSON-LD + robots). Nunca lança — falhas viram `fetched:false`. */
  probe(url: string): Promise<ProbeReport>
}

/** Resolvedor DNS injetável (default `node:dns/promises.lookup`) — testes injetam endereços fixos. */
export type AddressLookup = (hostname: string) => Promise<string[]>

const PAGE_TIMEOUT_MS = 5000
const MAX_REDIRECTS = 3

const defaultLookup: AddressLookup = async (hostname) => {
  const res = await lookup(hostname, { all: true })
  return res.map((r) => r.address)
}

/** Hostname normalizado (lowercase, sem `[]`, sem ponto final) de uma URL, ou `null` se inválida. */
function hostnameOf(url: string): string | null {
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
 * Lê o corpo da resposta com cap por streaming. No ESTOURO do cap, NÃO descarta tudo: trunca em
 * `MAX_HTML_BYTES` e devolve o prefixo — espelha o `RealRecipeImporter.import`, que faz `raw.slice(0,
 * MAX_HTML_BYTES)` e parseia assim mesmo (o JSON-LD vive no `<head>`, antes do corte), pra o veredito do
 * probe casar com o que a importação real faria. Só um ERRO de leitura no meio do stream (≠ estouro de
 * cap) ⇒ `null` (tratado como não-buscável).
 */
async function readCappedHtml(res: Response): Promise<string | null> {
  const body = res.body
  if (!body) {
    // Sem stream (alguns ambientes/mocks): cai no text() com corte (espelha o importer).
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
          // tem — não retorna null). Casa o `raw.slice(0, MAX_HTML_BYTES)` do importer.
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
 * Impl REAL — a ÚNICA I/O (DNS + fetch). NÃO é exercitada por teste de produção; os testes injetam o
 * `FakeRecipeProbe` ou mockam `fetch`/`lookup` para provar a FIAÇÃO. Qualquer erro vira `fetched:false`.
 */
export class RealRecipeProbe implements RecipeProbe {
  constructor(private readonly lookupFn: AddressLookup = defaultLookup) {}

  async probe(url: string): Promise<ProbeReport> {
    // Re-valida a barreira de SSRF defensivamente (a rota já roda parseProbeUrl, mas o seam não confia
    // no chamador) e resolve o host de ORIGEM. NENHUM fetch — nem robots.txt nem página — toca a rede
    // antes de o DNS confirmar que a origem NÃO é privada (defesa contra rebind, fecha o flanco também
    // do GET do robots.txt). Origem inválida/privada ⇒ não-buscável, robots fica no fail-open (true).
    const parsed = parseProbeUrl(url)
    const host = parsed === null ? null : hostnameOf(parsed)
    const originAllowed = host !== null && (await this.hostAllowed(host))
    if (parsed === null || !originAllowed) {
      return { fetched: false, jsonLd: 'absent', robotsAllowed: true }
    }

    // GUARD-RAIL robots (#272, ADR-0019): avalia o robots da ORIGEM PRIMEIRO; só busca a página se ele
    // PERMITIR. FAIL-OPEN (robots indisponível ⇒ true); uma proibição EXPLÍCITA (Disallow casando ⇒ false)
    // curto-circuita ANTES do fetch da página — espelha o `RealRecipeImporter`, que devolve `robots_blocked`
    // sem buscar. Não martelar (nem com o probe admin-manual) um site que nos proibiu.
    let robotsAllowed = true
    try {
      robotsAllowed = await robotsAllows(parsed, ROBOTS_UA_TOKEN)
    } catch {
      robotsAllowed = true // FAIL-OPEN (robotsAllows já não lança, mas cinto-e-suspensório)
    }
    if (!robotsAllowed) {
      return { fetched: false, jsonLd: 'absent', robotsAllowed: false }
    }

    const page = await this.fetchPage(parsed)
    if (!page) return { fetched: false, jsonLd: 'absent', robotsAllowed }
    return { fetched: true, jsonLd: jsonLdSignal(parseImportedRecipe(page.html, page.finalUrl)), robotsAllowed }
  }

  /** Resolve o host e rejeita se QUALQUER endereço for privado (defesa contra DNS-rebind). Erro ⇒ bloqueado. */
  private async hostAllowed(host: string): Promise<boolean> {
    try {
      const addrs = await this.lookupFn(host)
      if (addrs.length === 0) return false
      return addrs.every((a) => !isBlockedAddress(a))
    } catch {
      return false
    }
  }

  /**
   * Busca a página com follow LIMITADO e re-validado por hop. Cada hop: re-valida a URL (parseProbeUrl) +
   * resolve DNS (hostAllowed); `redirect:'manual'` para interceptar o `Location` e re-checá-lo. Non-2xx,
   * excesso de hops, cap estourado ou qualquer erro ⇒ `null`. Nunca lança.
   */
  private async fetchPage(startUrl: string): Promise<{ html: string; finalUrl: string } | null> {
    let currentUrl = parseProbeUrl(startUrl)
    if (currentUrl === null) return null

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const host = hostnameOf(currentUrl)
      if (host === null) return null
      if (!(await this.hostAllowed(host))) return null

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
}

/**
 * Dublê determinístico para testes: devolve o `ProbeReport` enlatado. Cada teste injeta UMA instância via
 * `setRecipeProbe` (como o `FakeRecipeImporter`). Ignora a URL — só ecoa o report.
 */
export class FakeRecipeProbe implements RecipeProbe {
  constructor(private readonly canned: ProbeReport) {}

  async probe(): Promise<ProbeReport> {
    return this.canned
  }
}
