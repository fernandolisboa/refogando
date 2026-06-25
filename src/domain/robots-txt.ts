/**
 * Avaliador PURO de robots.txt (#272, ADR-0019 emenda legal) — RFC 9309.
 *
 * Camada de DOMÍNIO, PURO: sem rede, sem DB. Recebe o CORPO de um robots.txt + o nosso product token
 * (`RefogandoBot`) + o `path` (pathname+search) e decide se podemos buscar. O fetch do robots.txt vive
 * no seam server-side (`RealRecipeImporter.checkRobotsAllowed`), que é FAIL-OPEN (robots indisponível ⇒
 * permitido). Logo a política só "pega" quando o robots.txt EXISTE e proíbe — e é esse caso que este
 * módulo precisa acertar.
 *
 * Regras (RFC 9309):
 *  - Grupos: um ou mais `User-agent:` consecutivos seguidos das regras (`Allow:`/`Disallow:`). Uma
 *    `User-agent:` DEPOIS de uma regra inicia um grupo NOVO (regras não vazam entre grupos).
 *  - Seleção: o grupo cujo agente casa o nosso token (case-INSENSITIVE); se nenhum, o grupo `*`. As
 *    regras de TODOS os grupos do agente escolhido são mescladas.
 *  - Match: o padrão casa um PREFIXO do path; `*` casa qualquer sequência; `$` (no fim) ancora o fim.
 *    O path é case-SENSITIVE.
 *  - Conflito: vence a regra de MAIOR especificidade = comprimento do PADRÃO (em chars, com `*`/`$`
 *    contando 1 cada — espelha o parser de referência do Google). EMPATE ⇒ Allow vence.
 *  - Valor vazio (`Disallow:` / `Allow:`) não tem efeito; `Disallow: /` bloqueia tudo.
 *  - Diretivas desconhecidas (Sitemap, Crawl-delay, Host…), comentários (`#…`), BOM e CRLF: ignorados/
 *    normalizados.
 */

type RobotsRule = { allow: boolean; pattern: string }
type RobotsGroup = { agents: string[]; rules: RobotsRule[] }

/** Quebra em linhas tolerando BOM, CRLF e CR sozinho. */
function normalizeLines(txt: string): string[] {
  return txt.replace(/^﻿/, '').split(/\r\n|\r|\n/)
}

/** `#` inicia comentário em qualquer ponto da linha (RFC 9309 §2.2.1). */
function stripComment(line: string): string {
  const h = line.indexOf('#')
  return h >= 0 ? line.slice(0, h) : line
}

function parseGroups(txt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = []
  let current: RobotsGroup | null = null
  let sawRule = false
  for (const raw of normalizeLines(txt)) {
    const line = stripComment(raw).trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue // linha sem `diretiva: valor` — ignora
    const directive = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (directive === 'user-agent') {
      // `User-agent` após uma regra ⇒ grupo NOVO; consecutivos ⇒ mesmo grupo (multi-agente).
      if (current === null || sawRule) {
        current = { agents: [], rules: [] }
        groups.push(current)
        sawRule = false
      }
      current.agents.push(value)
    } else if (directive === 'allow' || directive === 'disallow') {
      if (current === null) continue // regra antes de qualquer `User-agent`: sem grupo, ignora
      current.rules.push({ allow: directive === 'allow', pattern: value })
      sawRule = true
    }
    // outras diretivas (sitemap, crawl-delay, host…) não afetam o acesso: ignoradas
  }
  return groups
}

/** Regras do grupo do nosso token (case-insensitive); se nenhum, do grupo `*`. Mescla grupos repetidos. */
function selectRules(groups: RobotsGroup[], token: string): RobotsRule[] {
  const tokenLc = token.toLowerCase()
  const specific = groups.filter((g) => g.agents.some((a) => a.toLowerCase() === tokenLc))
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'))
  return chosen.flatMap((g) => g.rules)
}

/**
 * Casa um padrão de robots.txt contra `path` com semântica de PREFIXO. `*` casa qualquer sequência
 * (inclusive vazia); um `$` no FIM ancora o fim do path (match TOTAL). Um `$` fora do fim é literal.
 *
 * Implementação por dois ponteiros com UM ponto de retrocesso (greedy, estilo glob `*`-only) — O(n*m),
 * SEM backtracking exponencial. NÃO compila uma RegExp a partir do conteúdo (não-confiável) do
 * robots.txt: isso evita ReDoS (um padrão hostil com muitos `*` derrubaria o event loop) e o throw
 * "regex too large" de uma linha longa — o matcher é total, nunca lança.
 */
function matchesPattern(pattern: string, path: string): boolean {
  let pat = pattern
  let anchorEnd = false
  if (pat.endsWith('$')) {
    anchorEnd = true
    pat = pat.slice(0, -1)
  }
  let p = 0 // índice no path
  let s = 0 // índice no padrão
  let star = -1 // posição do último `*` visto no padrão
  let starPath = 0 // posição no path quando o último `*` foi aberto
  while (p < path.length) {
    if (s < pat.length && pat[s] === '*') {
      star = s
      starPath = p
      s++
    } else if (s < pat.length && pat[s] === path[p]) {
      s++
      p++
    } else if (s >= pat.length && !anchorEnd) {
      return true // padrão consumido + prefixo casado: o resto do path não importa
    } else if (star >= 0) {
      s = star + 1 // o último `*` engole mais um char do path (retrocesso ÚNICO, não exponencial)
      starPath++
      p = starPath
    } else {
      return false
    }
  }
  while (s < pat.length && pat[s] === '*') s++ // `*` finais casam a sequência vazia
  return s === pat.length // padrão totalmente consumido (cobre prefixo e âncora `$`)
}

/** Especificidade (= comprimento do PADRÃO, com `*`/`$` contando 1) se a regra casa o `path`; senão null. */
function matchLength(pattern: string, path: string): number | null {
  return matchesPattern(pattern, path) ? pattern.length : null
}

/**
 * `true` se o `userAgentToken` pode buscar `path` segundo o `robotsTxt`. Sem regras aplicáveis ⇒
 * permitido. Conflito resolvido por longest-match do PADRÃO; empate ⇒ Allow. `path` vazio ⇒ `/`.
 */
export function isPathAllowedByRobots(robotsTxt: string, userAgentToken: string, path: string): boolean {
  const rules = selectRules(parseGroups(robotsTxt), userAgentToken)
  if (rules.length === 0) return true
  const p = path === '' ? '/' : path
  let allowLen = -1
  let disallowLen = -1
  for (const rule of rules) {
    if (rule.pattern === '') continue // valor vazio = sem efeito (RFC 9309)
    const len = matchLength(rule.pattern, p)
    if (len === null) continue
    if (rule.allow) allowLen = Math.max(allowLen, len)
    else disallowLen = Math.max(disallowLen, len)
  }
  if (disallowLen < 0) return true // nenhum Disallow casou
  return allowLen >= disallowLen // empate ⇒ Allow vence
}
