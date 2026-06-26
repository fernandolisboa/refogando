/**
 * Meta-nível da tabela `vocabulary_term` (issue #314, ADR-0025 Fatia A).
 *
 * Divisão da ADR-0025 (Decisão 3): o META fica no CÓDIGO (quais dimensões existem =
 * `kind`; quais estados um termo percorre = `status`), mas QUAIS termos existem dentro
 * de uma dimensão vira DADO (linhas da tabela). Por isso `kind`/`status` são enums-do-
 * kernel (mesma forma de `report.ts`: array `as const` + tipo derivado + guard puro),
 * enquanto as cozinhas concretas viram a seed `COZINHA_SEED`.
 *
 * Esta fatia é PURAMENTE ADITIVA: a tabela nasce e é semeada, mas NADA ainda a lê — o
 * app continua lendo o `cozinhaEnum` (pgEnum) e o `cozinhaLabel` (i18n). O leitor (#315),
 * a validação (#316), os rótulos vindos da tabela (#317) e a virada enum→texto+FK (#318)
 * são as próximas fatias. A duplicação temporária com `COZINHAS`/`cozinhaLabel` é
 * sancionada pela ADR.
 */

// ── kind: quais DIMENSÕES de vocabulário existem (ADR-0025: só cozinha no passo 1) ──
export const VOCABULARY_KINDS = ['cozinha'] as const
export type VocabularyKind = (typeof VOCABULARY_KINDS)[number]

export function isVocabularyKind(value: string): value is VocabularyKind {
  return (VOCABULARY_KINDS as readonly string[]).includes(value)
}

// ── status: ciclo de vida de um termo (curadoria controlada — ADR-0025 Decisão 4) ──
//  - suggested  — proposto via "Outra" (#319), aguardando o Curador.
//  - active     — em uso, aparece como faceta/opção.
//  - deprecated — não oferecido em criações novas, mas ainda válido no acervo.
//  - merged      — fundido em outro termo (o canônico assume; #320).
//  - rejected    — recusado pelo Curador (tombstone, não reaparece).
export const VOCABULARY_TERM_STATUSES = [
  'suggested',
  'active',
  'deprecated',
  'merged',
  'rejected',
] as const
export type VocabularyTermStatus = (typeof VOCABULARY_TERM_STATUSES)[number]

export function isVocabularyTermStatus(value: string): value is VocabularyTermStatus {
  return (VOCABULARY_TERM_STATUSES as readonly string[]).includes(value)
}

/** Forma de uma linha-seed: o slug controlado + rótulos bilíngues + ordem de exibição. */
export type VocabularyTermSeed = {
  slug: string
  labelPtBr: string
  labelEnUs: string
  sort: number
}

/**
 * Seed inicial da dimensão `cozinha`: as 14 cozinhas que hoje vivem no `cozinhaEnum`
 * (rótulos copiados VERBATIM de `cozinhaLabel` em src/i18n/messages — pt-BR e en-US) +
 * `americana` (nova, destrava o seed de catálogo #238). Todas nascem `active` na migração
 * — imediatamente usáveis como faceta. `sort` segue a ordem de COZINHAS, americana por
 * último (reversível: o leitor #315 re-ordena por este campo).
 *
 * Esta é a FONTE ÚNICA copiada pela migração 0033 (INSERT) e pelo helper de teste
 * (`seedVocabularyCozinhas`) — o teste puro guarda contra drift com COZINHAS.
 */
export const COZINHA_SEED: VocabularyTermSeed[] = [
  { slug: 'italiana', labelPtBr: 'Italiana', labelEnUs: 'Italian', sort: 0 },
  { slug: 'japonesa', labelPtBr: 'Japonesa', labelEnUs: 'Japanese', sort: 1 },
  { slug: 'brasileira', labelPtBr: 'Brasileira', labelEnUs: 'Brazilian', sort: 2 },
  { slug: 'baiana', labelPtBr: 'Baiana', labelEnUs: 'Bahian', sort: 3 },
  { slug: 'mineira', labelPtBr: 'Mineira', labelEnUs: 'Minas Gerais', sort: 4 },
  { slug: 'mexicana', labelPtBr: 'Mexicana', labelEnUs: 'Mexican', sort: 5 },
  { slug: 'chinesa', labelPtBr: 'Chinesa', labelEnUs: 'Chinese', sort: 6 },
  { slug: 'indiana', labelPtBr: 'Indiana', labelEnUs: 'Indian', sort: 7 },
  { slug: 'tailandesa', labelPtBr: 'Tailandesa', labelEnUs: 'Thai', sort: 8 },
  { slug: 'francesa', labelPtBr: 'Francesa', labelEnUs: 'French', sort: 9 },
  { slug: 'arabe', labelPtBr: 'Árabe', labelEnUs: 'Arabic', sort: 10 },
  { slug: 'portuguesa', labelPtBr: 'Portuguesa', labelEnUs: 'Portuguese', sort: 11 },
  { slug: 'mediterranea', labelPtBr: 'Mediterrânea', labelEnUs: 'Mediterranean', sort: 12 },
  { slug: 'peruana', labelPtBr: 'Peruana', labelEnUs: 'Peruvian', sort: 13 },
  { slug: 'americana', labelPtBr: 'Americana', labelEnUs: 'American', sort: 14 },
]
