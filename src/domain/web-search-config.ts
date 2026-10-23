/**
 * Config da DESCOBERTA na WEB — admin-configurável (issue #164, ADR-0019). PURO: tipos + defaults +
 * validação + a checagem de ALLOWLIST (fonte ÚNICA de verdade compartilhada por DOIS consumidores —
 * o endpoint `/api/discovery/web` e o GUARD de SSRF do import `/api/recipes/import`).
 *
 * A Busca NUNCA cria; os links da web são uma PONTE de DESCOBERTA — externos, NÃO armazenados, FORA do
 * ranking interno (ADR-0019). Esta config liga/desliga a ponte e restringe a busca a uma ALLOWLIST de
 * domínios. O provedor concreto/credencial é GATE HUMANO de deploy (como a Gemini key) — o seam + Fake
 * + esta config ficam prontos; sem credencial, o Real se comporta como vazio/desligado.
 *
 * Forma `webSearch { enabled, allowlist }`:
 *  - `enabled`: liga/desliga a busca na web (desligada ⇒ o endpoint devolve vazio).
 *  - `allowlist`: lista de domínios (hostnames) permitidos. Vazia = NENHUM domínio liberado (fail-closed):
 *    sem allowlist o endpoint não tem onde buscar e o import recusa toda URL externa.
 *
 * `null` não aparece aqui (diferente do cap por papel): a config é um boolean + uma lista de strings.
 */

/** Config da descoberta na web (singleton `app_config`). */
export type WebSearchConfig = {
  enabled: boolean
  /** Domínios permitidos (hostnames canônicos, minúsculos). Vazio = fail-closed (nada liberado). */
  allowlist: string[]
}

/**
 * Default: descoberta na web DESLIGADA e allowlist VAZIA. Fail-closed por construção — a ponte só
 * existe depois que o admin a liga E define domínios E o deploy tem credencial (gate humano). Antes
 * disso o endpoint devolve vazio e o import recusa toda URL externa. Reversível pela `/admin/descoberta`.
 */
export const DEFAULT_WEB_SEARCH_CONFIG: WebSearchConfig = {
  enabled: false,
  allowlist: [],
}

/**
 * A config LIBERA a descoberta na web? Ligada E com ao menos um domínio na allowlist (fail-closed). Fonte
 * única para o endpoint `/api/discovery/web` (não toca o provedor quando `false`) e para a home (esconde
 * os gatilhos "Buscar na web" quando a descoberta não está ligada de fato).
 */
export function isWebSearchOpen(cfg: WebSearchConfig): boolean {
  return cfg.enabled && cfg.allowlist.length > 0
}

/**
 * Teto de tamanho da allowlist (defesa contra jsonb gigante / abuso). Cobre qualquer curadoria real
 * de domínios de receita com folga.
 */
const MAX_ALLOWLIST = 50

/**
 * DENYLIST de ToS (#394; `docs/legal/revisao-tos-allowlist.md` §4.0; parecer interno de 2026-10-22, §3)
 * — fonte ÚNICA. Domínios com cláusula de Termos de Uso lida VERBATIM que colide com a conduta do app
 * (automação / reprodução / armazenamento), ou sem Termos legíveis. Guard em CÓDIGO: `canonicalizeDomain`
 * os rejeita, então NEM o admin pode adicioná-los à allowlist por engano (o host exato E qualquer
 * subdomínio — mesma lógica de rótulo de `hostMatchesAllowlist`), `parseStoredAllowlist` os descarta da
 * allowlist já gravada no banco e `isUrlAllowed` recusa a URL de um host vetado mesmo que a allowlist traga
 * um sufixo pai dele (ex.: `com.br` gravado). Só RESTRINGE acesso → risco jurídico zero. REVERSÍVEL: se a
 * cláusula mudar ou o site der permissão escrita, remove-se o host daqui. Entradas em forma canônica
 * (minúsculo, sem `www.`). Os 7 domínios antes em "revisão manual" foram lidos ao vivo em 2026-10-22: 6
 * vetados (abaixo) e tudogostoso.com.br mantido, como receitasnestle.com.br (os dois com a condição de
 * reavaliar antes de a importação entrar num plano pago — parecer §3).
 *
 * ATENÇÃO ao remover um host daqui: a linha gravada em `app_config.web_search_allowlist` NÃO é limpa na
 * leitura — o filtro é só em memória, e o banco segue com o domínio vetado até o admin salvar a allowlist
 * de novo (o painel mostra a lista já filtrada, e salvar grava essa versão). Tirar um host desta lista
 * REVIVE em silêncio a entrada antiga que ainda estiver gravada: confira a linha de produção antes.
 */
export const TOS_DENYLIST: readonly string[] = [
  // panelinha.com.br — ToS 3.3 veda "qualquer sistema automatizado, inclusive... 'robôs', 'spiders',
  // 'scripts' ou 'offline readers'"; 6.2 veda "toda e qualquer forma de reprodução... total ou parcial".
  'panelinha.com.br',
  // guiadacozinha.com.br — Propriedade Intelectual: proíbe "download de nosso conteúdo para armazená-lo
  // em banco de dados" e criar "base de dados ou serviço que possa concorrer... com a plataforma".
  'guiadacozinha.com.br',
  // foodnetwork.com — ToS (Scripps Networks): vedam "robot or spider... to copy or 'scrape' the
  // Websites or Website Content for any purpose without the express written permission".
  'foodnetwork.com',
  // cybercook.com.br — em 2026-10-22 o domínio inteiro redireciona para carrefour.com.br: não há mais
  // receitas nem Termos de Uso do CyberCook para ler. Termos ilegíveis ⇒ excluir (regra do §4.0).
  'cybercook.com.br',
  // receiteria.com.br — Termos (Contteudo Network, mod. 2026-07-03) §2: os elementos do site "não podem
  // ser utilizadas de nenhuma outra forma a não ser para visualização dentro do site. A cópia, publicação
  // ou distribuição parcial ou integral em qualquer mídia, notadamente comercial, é estritamente proibida".
  'receiteria.com.br',
  // allrecipes.com — Termos da People Inc. (Effective Date: July 31, 2025) §3.3(e): "you shall not use any
  // manual or automated software, devices, or other processes (including but not limited to spiders,
  // robots, scrapers, crawlers...) to "scrape," harvest, or download data from the Services" (exceção só
  // para buscador público montar "publicly available searchable indices").
  'allrecipes.com',
  // simplyrecipes.com — mesmos Termos da People Inc. (31/07/2025), §3.3(e): veda robôs para "scrape,"
  // harvest, or download data from the Services".
  'simplyrecipes.com',
  // seriouseats.com — mesmos Termos da People Inc. (31/07/2025), §3.3(e): veda robôs para "scrape,"
  // harvest, or download data from the Services".
  'seriouseats.com',
  // bbcgoodfood.com — Termos da Immediate Media (Last updated: September 2025) §10: "you undertake not to
  // copy, store in any medium (including on any other website), distribute... any part of our Services
  // without our prior written permission".
  'bbcgoodfood.com',
]

/**
 * Um host cai na denylist de ToS se ele É um domínio vetado OU um SUBDOMÍNIO dele. Espelha a lógica de
 * rótulo de `hostMatchesAllowlist` (boundary via ponto: `evil-panelinha.com.br` NÃO casa
 * `panelinha.com.br`). O host chega já canônico (minúsculo, sem `www.`, sem ponto final). PURO.
 */
function hostMatchesDenylist(host: string): boolean {
  for (const domain of TOS_DENYLIST) {
    if (host === domain || host.endsWith('.' + domain)) return true
  }
  return false
}

/**
 * Normaliza um domínio cru para a forma canônica (trim + minúsculo + sem `www.` líder + sem ponto
 * final), SEM aplicar a denylist. Devolve `null` para entradas que NÃO são um hostname plausível
 * (vazio, com espaço, com esquema/porta/caminho, sem ponto). Base compartilhada por
 * `canonicalizeDomain` (que ainda aplica o guard de ToS), por `deniedDomainsIn` (que precisa
 * reconhecer o host vetado ANTES de rejeitá-lo, pra reportar o motivo) e por `parseStoredAllowlist`
 * (que descarta o vetado sozinho em vez de recusar a lista gravada inteira). PURO.
 */
function normalizeHost(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let d = raw.trim().toLowerCase()
  if (d === '') return null
  // Sem esquema, porta, caminho, query, espaço ou arroba — só um hostname.
  if (/[\s/@?#:]/.test(d)) return null
  if (d.endsWith('.')) d = d.slice(0, -1)
  if (d.startsWith('www.')) d = d.slice(4)
  // Precisa de ao menos um ponto (rejeita `localhost`, TLD solto), sem rótulo vazio nem wildcard cru.
  if (!d.includes('.') || d.startsWith('.') || d.includes('..') || d.includes('*')) return null
  // Caracteres válidos de hostname (rótulos alfanuméricos + hífen, separados por ponto).
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return null
  return d
}

/**
 * Canonicaliza um domínio cru da allowlist: trim + minúsculo + remove `www.` líder + remove um ponto
 * final. Devolve `null` para entradas que NÃO são um hostname plausível (vazio, com espaço, com
 * esquema/porta/caminho, sem ponto) OU para hosts vetados por ToS (`TOS_DENYLIST`, host exato ou
 * subdomínio — #394). Mantém a comparação de domínio simples e robusta (`isUrlAllowed` casa o host da
 * URL contra estes valores canônicos).
 */
export function canonicalizeDomain(raw: unknown): string | null {
  const d = normalizeHost(raw)
  if (d === null) return null
  // #394: guard de ToS — hosts vetados (e subdomínios) NUNCA viram allowlist, nem por engano do admin.
  if (hostMatchesDenylist(d)) return null
  return d
}

/**
 * Os domínios de um PUT cru de `webSearch` que caem na denylist de ToS (host exato ou subdomínio), na
 * forma canônica e sem repetição. Vazio = nenhum vetado. Usado pela rota admin pra devolver 400 com
 * MOTIVO claro (`dominio_vetado` + a lista) em vez do genérico `config_invalida` — sem engolir a
 * rejeição em silêncio. Aceita o objeto `webSearch` cru OU um array cru; lixo ⇒ `[]`. PURO.
 */
export function deniedDomainsIn(rawWebSearch: unknown): string[] {
  const rawAllowlist = Array.isArray(rawWebSearch)
    ? rawWebSearch
    : typeof rawWebSearch === 'object' && rawWebSearch !== null
      ? (rawWebSearch as { allowlist?: unknown }).allowlist
      : undefined
  if (!Array.isArray(rawAllowlist)) return []
  const denied: string[] = []
  const seen = new Set<string>()
  for (const item of rawAllowlist) {
    const h = normalizeHost(item)
    if (h !== null && hostMatchesDenylist(h) && !seen.has(h)) {
      seen.add(h)
      denied.push(h)
    }
  }
  return denied
}

/**
 * Valida + canonicaliza uma allowlist crua (entrada do PUT do admin). Aceita um array de strings;
 * canonicaliza cada uma. Qualquer inválida ⇒ rejeita o lote inteiro (não engole silenciosamente um
 * domínio mal digitado). Dedup preservando a ordem. Acima do teto ⇒ rejeita. Devolve `null` em
 * qualquer desvio (o route mapeia a 400). PURO.
 */
export function parseAllowlist(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  if (raw.length > MAX_ALLOWLIST) return null
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const d = canonicalizeDomain(item)
    if (d === null) return null
    if (!seen.has(d)) {
      seen.add(d)
      out.push(d)
    }
  }
  return out
}

/**
 * Allowlist JÁ GRAVADA no banco (leitura de `app_config.web_search_allowlist`). Difere de `parseAllowlist`
 * (o PUT) num ponto: um domínio que caiu na `TOS_DENYLIST` DEPOIS de gravado (ex.: os 6 vetados no
 * parecer de 2026-10-22) é DESCARTADO sozinho, e os demais seguem valendo. Pelo `parseAllowlist`, um único
 * vetado zeraria a lista inteira e desligaria a Descoberta em produção sem aviso. Fora isso, mesma
 * disciplina fail-closed: não-array, item que não é hostname ou acima do teto ⇒ `null` (o loader cai em
 * `[]`). Canonicaliza e dedup preservando a ordem. PURO.
 */
export function parseStoredAllowlist(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  if (raw.length > MAX_ALLOWLIST) return null
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const d = normalizeHost(item)
    if (d === null) return null
    if (hostMatchesDenylist(d)) continue
    if (!seen.has(d)) {
      seen.add(d)
      out.push(d)
    }
  }
  return out
}

export type WebSearchConfigParse = { ok: true; value: WebSearchConfig } | { ok: false }

/**
 * Valida o objeto `webSearch` cru do PUT (substituição COMPLETA — a UI sempre envia os 2 campos).
 * `enabled` boolean; `allowlist` válida. Qualquer desvio ⇒ `{ ok: false }` (o route mapeia a 400).
 * PURO: sem DB/I/O.
 */
export function parseWebSearchConfig(raw: unknown): WebSearchConfigParse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false }
  const obj = raw as { enabled?: unknown; allowlist?: unknown }
  if (typeof obj.enabled !== 'boolean') return { ok: false }
  const allowlist = parseAllowlist(obj.allowlist)
  if (allowlist === null) return { ok: false }
  return { ok: true, value: { enabled: obj.enabled, allowlist } }
}

/**
 * Um host está coberto pela allowlist se ele É um domínio listado OU um SUBDOMÍNIO dele (`*.dominio`).
 * Comparação contra os valores JÁ canônicos (minúsculos, sem `www.`). Ex.: allowlist `['tudogostoso.com.br']`
 * cobre `tudogostoso.com.br` e `m.tudogostoso.com.br`, mas NÃO `evil-tudogostoso.com.br` (boundary de
 * rótulo via o ponto). PURO.
 */
function hostMatchesAllowlist(host: string, allowlist: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  const bare = h.startsWith('www.') ? h.slice(4) : h
  // Host vetado por ToS nunca passa, nem coberto por um sufixo pai que esteja na allowlist (ex.: `com.br`
  // gravado deixaria `panelinha.com.br` entrar). A denylist vale sozinha aqui, sem depender de quem montou
  // a allowlist (PUT, leitura do banco ou um chamador futuro).
  if (hostMatchesDenylist(bare)) return false
  for (const domain of allowlist) {
    if (bare === domain || bare.endsWith('.' + domain)) return true
  }
  return false
}

/**
 * GUARD de SSRF + allowlist (fonte ÚNICA, ADR-0019): uma URL é importável/buscável SÓ se for http(s)
 * bem-formada E seu host estiver na allowlist E fora da `TOS_DENYLIST`. Allowlist vazia ⇒ NADA passa
 * (fail-closed). Recusa file:/ftp:/javascript:/data:, qualquer host fora da curadoria e host vetado por ToS
 * (mesmo sob um sufixo pai listado). NÃO toca a rede (a resolução de IP /
 * defesa contra rebind fica no fetch real; aqui é a barreira de domínio declarativa). PURO.
 */
export function isUrlAllowed(url: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  if (u.hostname === '') return false
  return hostMatchesAllowlist(u.hostname, allowlist)
}
