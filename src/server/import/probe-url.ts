/**
 * Barreira de SSRF do PROBE de saúde (#273, ADR-0019) — validação de URL + classificação de IP privado.
 *
 * SERVER-ONLY (usa `node:net`): o probe é o PRIMEIRO ponto do código onde uma URL admin-arbitrária chega
 * ao `fetch` SEM a barreira de allowlist (que o import usa como sua defesa SSRF). Esta é a barreira que a
 * substitui: só http(s), e — crucialmente — REJEITA endereços privados/loopback/link-local por `net.isIP`
 * + CIDR sobre os BYTES canônicos (NÃO por string-match, que `[::ffff:127.0.0.1]`/`localhost.` furam).
 *
 * `parseProbeUrl` NÃO resolve DNS (isso é I/O — fica no seam `recipe-probe.ts`, que re-checa CADA endereço
 * resolvido com `isBlockedAddress` antes de conectar). Aqui só fechamos o flanco dos IP-LITERAIS e dos
 * hostnames obviamente-internos. PURO (sem rede).
 */
import { isIP } from 'node:net'

/** Classifica um IPv4 dotted (4 octetos 0-255) como privado/reservado. Malformado ⇒ bloqueado (defensivo). */
function isBlockedV4(ip: string): boolean {
  const parts = ip.split('.')
  if (parts.length !== 4) return true
  const octets = parts.map((p) => Number(p))
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = octets
  if (a === 0) return true // 0.0.0.0/8 (this-network / unspecified)
  if (a === 10) return true // 10/8 privado
  if (a === 127) return true // 127/8 loopback
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64/10 CGNAT
  if (a === 169 && b === 254) return true // 169.254/16 link-local (inclui o metadata 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12 privado
  if (a === 192 && b === 168) return true // 192.168/16 privado
  return false
}

/**
 * Expande um IPv6 (já validado por `net.isIP`) para 16 bytes, resolvendo o `::` e um sufixo IPv4 embutido
 * (`::ffff:a.b.c.d`). Devolve `null` se não conseguir parsear (tratado como bloqueado pelo chamador).
 */
function v6ToBytes(ip: string): number[] | null {
  let h = ip.toLowerCase()
  const pct = h.indexOf('%')
  if (pct >= 0) h = h.slice(0, pct) // descarta zone-id (fe80::1%eth0)

  // Sufixo IPv4 embutido → converte para dois grupos hex.
  const lastColon = h.lastIndexOf(':')
  if (lastColon >= 0 && h.slice(lastColon + 1).includes('.')) {
    const v4 = h.slice(lastColon + 1).split('.').map((p) => Number(p))
    if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
    const g1 = ((v4[0] << 8) | v4[1]).toString(16)
    const g2 = ((v4[2] << 8) | v4[3]).toString(16)
    h = h.slice(0, lastColon + 1) + g1 + ':' + g2
  }

  const halves = h.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : []
  let groups: string[]
  if (halves.length === 2) {
    const missing = 8 - (head.length + tail.length)
    if (missing < 0) return null
    groups = [...head, ...Array(missing).fill('0'), ...tail]
  } else {
    groups = head
  }
  if (groups.length !== 8) return null
  const bytes: number[] = []
  for (const g of groups) {
    const v = parseInt(g || '0', 16)
    if (Number.isNaN(v) || v < 0 || v > 0xffff) return null
    bytes.push((v >> 8) & 0xff, v & 0xff)
  }
  return bytes
}

/** Classifica um IPv6 como privado/loopback/link-local; IPv4-mapped (`::ffff:a.b.c.d`) cai nas faixas v4. */
function isBlockedV6(ip: string): boolean {
  const bytes = v6ToBytes(ip)
  if (bytes === null) return true
  // IPv4-mapped: ::ffff:a.b.c.d (10 bytes zero + 0xffff) → re-checa o v4 embutido.
  const mapped = bytes.slice(0, 10).every((x) => x === 0) && bytes[10] === 0xff && bytes[11] === 0xff
  if (mapped) return isBlockedV4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`)
  if (bytes.every((x) => x === 0)) return true // :: (unspecified)
  if (bytes.slice(0, 15).every((x) => x === 0) && bytes[15] === 1) return true // ::1 loopback
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true // fe80::/10 link-local
  if ((bytes[0] & 0xfe) === 0xfc) return true // fc00::/7 unique-local
  return false
}

/**
 * `true` se o `ip` (IPv4 ou IPv6, qualquer forma reconhecida por `net.isIP`) é privado/loopback/link-local
 * e NÃO deve ser buscado. Algo que não é IP reconhecido ⇒ bloqueado (defensivo). Reusado pelo seam na
 * checagem dos endereços RESOLVIDOS por DNS (defesa contra rebind). PURO.
 */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) return isBlockedV4(ip)
  if (kind === 6) return isBlockedV6(ip)
  return true
}

/**
 * Valida + normaliza uma URL crua colada pelo admin para o probe. Devolve a URL normalizada (string) ou
 * `null` (⇒ a rota mapeia a 400 ANTES de qualquer rede). Regras:
 *  - só `http:`/`https:` (recusa ftp/file/javascript/data…);
 *  - ZERA o userinfo (`user:pass@host`): senão o `fetch` mandaria `Authorization: Basic` ao host colado
 *    pelo admin — o probe NUNCA autentica em host arbitrário;
 *  - normaliza o host (lowercase, tira `[]`, tira ponto final);
 *  - IP-literal privado/loopback/link-local ⇒ `null` (`net.isIP` + CIDR, pega decimal/octal/hex que o
 *    `new URL` normaliza para dotted, e o IPv4-mapped/`[::1]`);
 *  - hostname `localhost`/`*.localhost`/`*.local`/`*.internal` ⇒ `null`.
 * NÃO resolve DNS (I/O fica no seam). PURO.
 */
export function parseProbeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null

  let host = u.hostname.toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (host.endsWith('.')) host = host.slice(0, -1)
  if (host === '') return null

  // Zera credenciais embutidas (`https://user:pass@host/…`) ANTES de qualquer `u.toString()`: senão o
  // `fetch` enviaria `Authorization: Basic` ao host arbitrário. O probe nunca autentica em terceiros.
  u.username = ''
  u.password = ''

  const kind = isIP(host)
  if (kind > 0) {
    return isBlockedAddress(host) ? null : u.toString()
  }
  if (host === 'localhost' || host.endsWith('.localhost')) return null
  if (host.endsWith('.local') || host.endsWith('.internal')) return null
  return u.toString()
}
