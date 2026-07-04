/**
 * Glossário culinário pt↔en (issue #426, ADR-0030 decisão 3) — domínio PURO, client-safe.
 *
 * Lista ESTÁTICA de termos que a tradução automática erra ou traduz de forma inconsistente,
 * injetada no system prompt do `RealTranslator` para naturalidade e consistência. NÃO é tabela
 * curável (falta o gatilho de curadoria-sem-deploy do ADR-0025 — termos culinários mudam por
 * deploy). Versionada junto do prompt via `TRANSLATION_PROMPT_VERSION` (translation-prompt.ts).
 *
 * Cada termo tem uma REGRA:
 *  - `traduzir`: use o equivalente do idioma-alvo (refogar → sauté, a gosto → to taste).
 *  - `manter`: NÃO traduza — o termo é um nome próprio/empréstimo que se preserva na receita
 *    culinária internacional (guanciale, al dente, pão de queijo). Vale nas duas direções.
 *
 * A cozinha/categoria/restrição NÃO entram aqui — são localizadas por DADO (cozinha-label.ts,
 * categoriaLabel/restricaoLabel), fora do tradutor LLM (evita duas fontes de verdade).
 */

export type GlossaryRule = 'traduzir' | 'manter'

export type GlossaryTerm = {
  /** Forma em pt-BR. */
  ptBR: string
  /** Forma em en-US (igual ao ptBR quando `manter`). */
  enUS: string
  rule: GlossaryRule
  /** Armadilha comum de MT a evitar (renderizada como aviso no prompt). */
  cuidado?: string
}

/**
 * ~30 termos de alto risco de erro-de-MT. Foca no que a máquina erra (couve → "cabbage",
 * creme de leite → "milk cream", selar → "seal"), não em traduções triviais (manteiga → butter).
 */
export const CULINARY_GLOSSARY: readonly GlossaryTerm[] = [
  // Técnicas
  { ptBR: 'refogar', enUS: 'sauté', rule: 'traduzir' },
  { ptBR: 'selar', enUS: 'sear', rule: 'traduzir', cuidado: 'nunca "seal"' },
  { ptBR: 'dourar', enUS: 'brown', rule: 'traduzir' },
  { ptBR: 'escaldar', enUS: 'blanch', rule: 'traduzir' },
  { ptBR: 'apurar', enUS: 'reduce', rule: 'traduzir' },
  { ptBR: 'peneirar', enUS: 'sift', rule: 'traduzir' },
  { ptBR: 'temperar', enUS: 'season', rule: 'traduzir' },
  { ptBR: 'deixar de molho', enUS: 'to soak', rule: 'traduzir', cuidado: 'nunca "of sauce"' },
  { ptBR: 'banho-maria', enUS: 'bain-marie (double boiler)', rule: 'traduzir' },
  // Pontos / estados
  { ptBR: 'ponto de neve', enUS: 'stiff peaks', rule: 'traduzir' },
  { ptBR: 'ponto de bala', enUS: 'soft-ball stage', rule: 'traduzir' },
  { ptBR: 'al dente', enUS: 'al dente', rule: 'manter' },
  { ptBR: 'a gosto', enUS: 'to taste', rule: 'traduzir' },
  { ptBR: 'q.b.', enUS: 'as needed', rule: 'traduzir' },
  { ptBR: 'fio de azeite', enUS: 'drizzle of olive oil', rule: 'traduzir' },
  // Ingredientes que a MT confunde
  { ptBR: 'couve', enUS: 'collard greens', rule: 'traduzir', cuidado: 'nunca "cabbage" (isso é repolho)' },
  { ptBR: 'creme de leite', enUS: 'heavy cream', rule: 'traduzir', cuidado: 'nunca "milk cream"' },
  { ptBR: 'coentro', enUS: 'cilantro', rule: 'traduzir' },
  { ptBR: 'salsinha', enUS: 'parsley', rule: 'traduzir', cuidado: 'distinta de coentro=cilantro' },
  { ptBR: 'cebolinha', enUS: 'scallion (green onion)', rule: 'traduzir' },
  { ptBR: 'pimentão', enUS: 'bell pepper', rule: 'traduzir', cuidado: 'distinto de pimenta=chili' },
  { ptBR: 'pimenta-do-reino', enUS: 'black pepper', rule: 'traduzir' },
  { ptBR: 'fubá', enUS: 'cornmeal', rule: 'traduzir' },
  { ptBR: 'polvilho', enUS: 'tapioca starch', rule: 'traduzir' },
  { ptBR: 'mandioca', enUS: 'cassava', rule: 'traduzir', cuidado: 'aipim/macaxeira = mesma raiz' },
  { ptBR: 'azeite', enUS: 'olive oil', rule: 'traduzir', cuidado: 'não o genérico "oil"' },
  { ptBR: 'caldo', enUS: 'stock', rule: 'traduzir' },
  // Nomes próprios / empréstimos que se preservam
  { ptBR: 'requeijão', enUS: 'requeijão', rule: 'manter', cuidado: 'nunca "cottage cheese"' },
  { ptBR: 'pão de queijo', enUS: 'pão de queijo', rule: 'manter' },
  { ptBR: 'brigadeiro', enUS: 'brigadeiro', rule: 'manter' },
  { ptBR: 'guanciale', enUS: 'guanciale', rule: 'manter' },
  { ptBR: 'pancetta', enUS: 'pancetta', rule: 'manter' },
  { ptBR: 'mise en place', enUS: 'mise en place', rule: 'manter' },
] as const

/**
 * Renderiza o glossário como linhas de texto para o system prompt, na DIREÇÃO da tradução.
 * Puro/determinístico (testável byte-a-byte). `traduzir` mostra origem → alvo; `manter` instrui a
 * preservar o termo (na forma do idioma de ORIGEM). Locales fora de pt-BR/en-US caem na direção
 * pt→en como default seguro (só há 2 locales; nunca tela quebrada).
 */
export function formatGlossaryForPrompt(sourceLocale: string, targetLocale: string): string {
  const ptToEn = !(sourceLocale === 'en-US' && targetLocale === 'pt-BR')
  return CULINARY_GLOSSARY.map((t) => {
    const from = ptToEn ? t.ptBR : t.enUS
    const to = ptToEn ? t.enUS : t.ptBR
    const cuidado = t.cuidado ? ` (${t.cuidado})` : ''
    if (t.rule === 'manter') return `- "${from}": mantenha como está, não traduza${cuidado}.`
    return `- "${from}" → "${to}"${cuidado}.`
  }).join('\n')
}
