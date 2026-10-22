/**
 * Orçamento de RAJADA por IP, em memória e por instância (best-effort, como o `createDomainRateLimiter` da
 * importação; issue #590, ADR-0048 dec 4). Janela fixa por chave: até `max` requests a cada `windowMs`,
 * contadas a partir do 1º request da janela. Diferente do limitador por domínio (1 por intervalo), aceita a
 * rajada curta legítima e só barra o martelo.
 *
 * Memória limitada de dois jeitos, sem varrer o Map a cada chamada: a poda das janelas vencidas roda no
 * máximo UMA vez por `windowMs`, e o Map nunca passa de `maxKeys` (chave nova com o Map cheio despeja a
 * mais antiga por ordem de inserção, O(1)). Cold start zera tudo; burst distribuído por instâncias passa.
 * É anti-flood do log, não quota.
 */

export interface IpBurstLimiter {
  /** `true` se ainda cabe na janela da chave (e conta); `false` se a rajada da chave já se esgotou. */
  tryAcquire(key: string): boolean
  /** Chaves guardadas agora (teste/diagnóstico). */
  size(): number
}

type Bucket = { start: number; count: number }

export function createIpBurstLimiter(opts: {
  max: number
  windowMs: number
  maxKeys?: number
  now?: () => number
}): IpBurstLimiter {
  const { max, windowMs } = opts
  const maxKeys = opts.maxKeys ?? 10_000
  const now = opts.now ?? (() => Date.now())
  const buckets = new Map<string, Bucket>()
  let lastPrune = Number.NEGATIVE_INFINITY

  return {
    tryAcquire(key: string): boolean {
      const t = now()
      if (t - lastPrune >= windowMs) {
        lastPrune = t
        for (const [k, b] of buckets) if (t - b.start >= windowMs) buckets.delete(k)
      }
      const b = buckets.get(key)
      if (b && t - b.start < windowMs) {
        if (b.count >= max) return false // bloqueado não conta nem estende a janela
        b.count += 1
        return true
      }
      if (b) buckets.delete(key) // janela vencida: reinsere no fim (a ordem de inserção é a de despejo)
      else if (buckets.size >= maxKeys) {
        const oldest = buckets.keys().next()
        if (!oldest.done) buckets.delete(oldest.value)
      }
      buckets.set(key, { start: t, count: 1 })
      return true
    },
    size: () => buckets.size,
  }
}

const IPV4_MAPPED_RE = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/

/**
 * Chave de limite de um IP: IPv4 como veio; IPv6 pelo prefixo /64 (`2001:db8:1:2::/64`) — um único cliente
 * IPv6 costuma ter a /64 inteira e giraria de endereço para escapar do limite. IPv4 mapeado em IPv6
 * (`::ffff:1.2.3.4`) volta a ser o IPv4. Zona (`%eth0`) e colchetes saem. Entrada que não parece IP fica
 * como veio (o teto de tamanho é do `clientIpFromHeaders`).
 */
export function ipRateKey(ip: string): string {
  const s = ip.trim().toLowerCase().replace(/^\[|\]$/g, '').split('%', 1)[0]
  if (!s.includes(':')) return s
  const mapped = IPV4_MAPPED_RE.exec(s)
  if (mapped) return mapped[1]
  const [head, tail] = s.split('::', 2)
  const left = head ? head.split(':') : []
  let groups = left
  if (tail !== undefined) {
    const right = tail ? tail.split(':') : []
    groups = [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
  }
  const prefix = groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '') || '0')
  while (prefix.length < 4) prefix.push('0')
  return `${prefix.join(':')}::/64`
}
