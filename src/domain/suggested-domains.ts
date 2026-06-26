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
 * Listas curadas por locale-origem. Renderizadas as DUAS (a allowlist é global — pt-BR e en-US consomem
 * a mesma), sob rótulos "Brasil"/"Internacional". Todas as entradas já são CANÔNICAS (minúsculas, sem
 * `www.`, hostname válido) — o teste de paridade trava isso.
 */
export const SUGGESTED_DOMAINS: { 'pt-BR': string[]; 'en-US': string[] } = {
  'pt-BR': [
    'tudogostoso.com.br',
    'panelinha.com.br',
    'cybercook.com.br',
    'receiteria.com.br',
    'guiadacozinha.com.br',
    'receitasnestle.com.br',
  ],
  'en-US': [
    'allrecipes.com',
    'simplyrecipes.com',
    'seriouseats.com',
    'foodnetwork.com',
    'bbcgoodfood.com',
  ],
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
