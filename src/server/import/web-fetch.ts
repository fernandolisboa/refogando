/**
 * Helpers de REDE compartilhados pela importação de receita (#165, #272) e pelo probe de saúde (#273).
 *
 * Extração de MENOR risco do `recipe-importer.ts`: as constantes de fetch + o fetch do robots.txt (que é
 * BYTE-IDÊNTICO entre importer e probe — mesmo UA, redirect:'manual', timeout curto, cap, FAIL-OPEN). O
 * fetch da PÁGINA NÃO é extraído: as políticas de redirect divergem (o importer segue `follow`; o probe,
 * que recebe URL admin-arbitrária, faz follow LIMITADO e re-valida cada hop contra a barreira de SSRF).
 *
 * `robotsAllows` é FAIL-OPEN deliberado (≠ o fail-CLOSED da allowlist): robots indisponível ⇒ permitido.
 * Só uma proibição EXPLÍCITA bloqueia. NÃO é exercitado por teste real (rede) — os testes injetam `fetch`.
 */
import { isPathAllowedByRobots } from '@/domain/robots-txt'

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
