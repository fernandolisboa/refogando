/**
 * Rate-limit de POLITENESS por domínio para a importação de receitas (#272, ADR-0019).
 *
 * Objetivo: não martelar o site de origem — no MÁXIMO ~1 tentativa de importação por segundo por
 * domínio (uma tentativa = fetch do robots.txt + da página). NÃO é uma quota dura nem uma defesa de
 * segurança: o estado vive in-memory NA INSTÂNCIA. No Vercel cada instância serverless tem o seu Map,
 * então o limite é best-effort POR-INSTÂNCIA — um burst distribuído por várias instâncias pode passar,
 * e um cold start zera a janela. É politeness, não garantia global; não prometemos mais que isso.
 *
 * O clock é INJETÁVEL (`now`) para teste determinístico. A janela é deslizante: uma tentativa BLOQUEADA
 * NÃO reinicia a janela (registramos só no sucesso). Entradas fora da janela são PODADAS a cada chamada,
 * então o Map fica limitado ao nº de domínios tocados na janela atual (sem leak de memória).
 */

export interface DomainRateLimiter {
  /** `true` se pode buscar agora (e registra o instante); `false` se ainda dentro da janela do domínio. */
  tryAcquire(domain: string): boolean
}

export function createDomainRateLimiter(
  opts: { minIntervalMs?: number; now?: () => number } = {},
): DomainRateLimiter {
  const minIntervalMs = opts.minIntervalMs ?? 1000
  const now = opts.now ?? (() => Date.now())
  const lastHit = new Map<string, number>()

  return {
    tryAcquire(domain: string): boolean {
      const t = now()
      // Poda entradas já fora da janela: bound de memória = domínios tocados na janela corrente.
      for (const [d, ts] of lastHit) {
        if (t - ts >= minIntervalMs) lastHit.delete(d)
      }
      const last = lastHit.get(domain)
      if (last !== undefined && t - last < minIntervalMs) {
        return false // dentro da janela ⇒ bloqueado; NÃO atualiza (a janela não desliza no bloqueio)
      }
      lastHit.set(domain, t)
      return true
    },
  }
}
