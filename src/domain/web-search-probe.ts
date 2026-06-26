/**
 * Derivação PURA do veredito do PROBE de saúde (#273, ADR-0019) — JSON-LD + robots → "importável?".
 *
 * Camada de DOMÍNIO, PURO e CLIENT-SAFE (sem `node:` imports — a UI importa `isImportable`/`ProbeReport`):
 * recebe o `ParseResult` do parser de JSON-LD (`recipe-import-parse.ts`) e os booleans de rede e produz um
 * relatório de 3 eixos. A parte com I/O (fetch da página + robots.txt) e a barreira de SSRF (que precisam
 * de `node:net`/`node:dns`) vivem no SERVER (`server/import/recipe-probe.ts` + `server/import/probe-url.ts`).
 *
 * O probe NÃO persiste nada e NÃO toca a config — é só um check de uma URL ainda-NÃO-vetada, antes de o
 * admin decidir adicioná-la à allowlist.
 */
import type { ParseResult } from '@/domain/recipe-import-parse'

/**
 * Relatório do probe. `jsonLd` é DISCRIMINADO em 3 estados (não colapsa `unsupported_locale` em "sem
 * JSON-LD"): a página até TEM `schema.org/Recipe`, só num idioma fora de PT/EN — sinal diferente de
 * "não tem JSON-LD". `fetched:false` ⇒ a página nem carregou (os outros eixos são indeterminados).
 */
export type ProbeReport = {
  fetched: boolean
  jsonLd: 'present' | 'present_unsupported_locale' | 'absent'
  robotsAllowed: boolean
}

/** Mapeia o `ParseResult` do JSON-LD para o sinal de 3 estados do relatório. PURO. */
export function jsonLdSignal(parse: ParseResult): ProbeReport['jsonLd'] {
  if (parse.ok) return 'present'
  return parse.reason === 'unsupported_locale' ? 'present_unsupported_locale' : 'absent'
}

/**
 * Veredito VERDE ("estruturalmente importável"): a página carregou, tem Recipe JSON-LD UTILIZÁVEL (PT/EN)
 * E o robots permite. `present_unsupported_locale` ⇒ false (idioma fora de PT/EN não importa — ADR-0001).
 * NÃO significa "import funciona agora": o caminho real ainda exige vetar o domínio (allowlist) + o
 * rate-limit de politeness — a cópia da UI reflete "pronto pra importar APÓS vetar". PURO.
 */
export function isImportable(r: ProbeReport): boolean {
  return r.fetched && r.jsonLd === 'present' && r.robotsAllowed
}
