/**
 * Domínios sugeridos para a curadoria da allowlist (#273, ADR-0019).
 *
 * Camada de DOMÍNIO, PURO: sem rede, sem DB. Uma lista CURADA hardcoded de sites de receita (PT-BR e
 * internacionais) que o admin pode acrescentar à allowlist com um clique — um ATALHO de digitação, NÃO
 * uma allowlist automática. Clicar SÓ acrescenta o domínio ao texto local do campo; o ato de VETAR
 * continua sendo o admin salvar a allowlist (fonte ÚNICA, `web-search-config.ts`). Sugerir ≠ ativar.
 *
 * O dedup é CANONICALIZADO (`canonicalizeDomain` — mesma fonte da validação do PUT) e null-safe: uma
 * linha-lixo no textarea (que não é hostname) não casa nem impede o append.
 */
import { canonicalizeDomain } from '@/domain/web-search-config'

/**
 * Listas curadas por locale-origem. Renderizadas as duas, quando não vazias (a allowlist é global — pt-BR e en-US consomem
 * a mesma), sob rótulos "Brasil"/"Internacional". Todas as entradas já são CANÔNICAS (minúsculas, sem
 * `www.`, hostname válido) — o teste de paridade trava isso. NÃO pode conter domínio da `TOS_DENYLIST`
 * (#394): sugerir um host que a allowlist rejeita seria um chip morto e contradiz o guard de ToS — por
 * isso panelinha/guiadacozinha/foodnetwork saíram desta lista.
 *
 * SÓ entra aqui domínio com ToS LIDO e recomendação "manter" (`docs/legal/revisao-tos-allowlist.md` §4.4).
 * Os 7 em "revisão manual" (§4.5: tudogostoso, cybercook, receiteria, allrecipes, simplyrecipes,
 * seriouseats, bbcgoodfood) saíram: um clique os poria na allowlist sem a leitura verbatim do contrato.
 * Voltam para cá só depois dessa leitura. Um grupo vazio não é renderizado.
 */
export const SUGGESTED_DOMAINS: { 'pt-BR': string[]; 'en-US': string[] } = {
  'pt-BR': ['receitasnestle.com.br'],
  'en-US': [],
}

/** Conjunto dos domínios CANÔNICOS já presentes no texto (linhas-lixo viram null e são descartadas). */
function canonicalLines(currentText: string): Set<string> {
  const set = new Set<string>()
  for (const line of currentText.split('\n')) {
    const c = canonicalizeDomain(line)
    if (c !== null) set.add(c)
  }
  return set
}

/** `true` se o `domain` (comparado canonicalizado) já aparece numa linha do texto. Marca o chip como já-adicionado. */
export function isSuggestionPresent(currentText: string, domain: string): boolean {
  const target = canonicalizeDomain(domain)
  if (target === null) return false
  return canonicalLines(currentText).has(target)
}

/**
 * Acrescenta `domain` ao texto da allowlist SE ainda não estiver presente (dedup canônico). Preserva o
 * texto/quebras existentes — só adiciona uma nova linha quando necessário (texto vazio ⇒ sem newline
 * líder; texto que já termina em `\n` ⇒ sem newline duplicada). Domínio não-canonicalizável ⇒ no-op.
 */
export function addDomainToAllowlistText(currentText: string, domain: string): string {
  const target = canonicalizeDomain(domain)
  if (target === null) return currentText
  if (canonicalLines(currentText).has(target)) return currentText
  const needsNewline = currentText !== '' && !currentText.endsWith('\n')
  return currentText + (needsNewline ? '\n' : '') + target
}
