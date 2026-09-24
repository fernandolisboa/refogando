/**
 * Decisão PURA da lista do Curador — traduções defasadas-E-divergentes (issue #500, ADR-0031
 * decisão 6). É o "outro lado da moeda" da fatia B (re-tradução automática, #499): enquanto B
 * só sobrescreve linhas INTOCADAS (`mt_fingerprint` bate com o conteúdo atual), esta função
 * decide quais linhas defasadas NÃO são intocadas — essas nunca são auto-sobrescritas e vão
 * para re-revisão HUMANA.
 *
 * As DUAS metades são independentes e compostas por AND (nunca uma sozinha):
 *  - `isDefasada`: a FONTE mudou desde a última MT (`fingerprintSource` diverge do gravado) OU
 *    o tradutor melhorou (`promptVersion` gravado < `TRANSLATION_PROMPT_VERSION` atual — `null`
 *    conta como "abaixo de qualquer versão", legado nunca versionado).
 *  - `isDivergente`: o CONTEÚDO da linha já diverge da última MT (`fingerprintMt` recomputado
 *    ≠ gravado) OU não há prova de intocabilidade (`mt_fingerprint` gravado é `null` — legado).
 *
 * Recebe os HASHES já computados (não os campos crus): o caller monta `currentSourceFingerprint`/
 * `currentMtFingerprint` chamando `fingerprintSource`/`fingerprintMt` (`translation-fingerprint.ts`)
 * com EXATAMENTE a mesma construção de campos que `ensureTranslation` usa na escrita — espelhar essa
 * construção é responsabilidade do caller (server), não desta função (puro compara strings/números).
 */

export type DivergentStaleInput = {
  /** `fingerprintSource` recomputado AGORA a partir da fonte atual (locale original + ingredientes). */
  currentSourceFingerprint: string
  /** `recipe_translation.source_fingerprint` gravado na linha (a última MT que rodou). */
  storedSourceFingerprint: string | null
  /** `recipe_translation.prompt_version` gravado na linha. `null` = legado (nunca versionado). */
  storedPromptVersion: number | null
  /** `TRANSLATION_PROMPT_VERSION` atual (constante do domínio, `translation-prompt.ts`). */
  translationPromptVersion: number
  /** `fingerprintMt` recomputado AGORA a partir do conteúdo atual da linha (título/corpo + nomes). */
  currentMtFingerprint: string
  /** `recipe_translation.mt_fingerprint` gravado na linha. `null` = nunca intocada (trava ADR-0031 dec.2). */
  storedMtFingerprint: string | null
}

/** A FONTE mudou desde a última MT, ou o tradutor evoluiu de versão. */
export function isDefasada(
  input: Pick<
    DivergentStaleInput,
    'currentSourceFingerprint' | 'storedSourceFingerprint' | 'storedPromptVersion' | 'translationPromptVersion'
  >,
): boolean {
  return (
    input.currentSourceFingerprint !== input.storedSourceFingerprint ||
    input.storedPromptVersion == null ||
    input.storedPromptVersion < input.translationPromptVersion
  )
}

/** O CONTEÚDO da linha já diverge da última MT (editado à mão) — ou é legado sem prova (`null`). */
export function isDivergente(
  input: Pick<DivergentStaleInput, 'currentMtFingerprint' | 'storedMtFingerprint'>,
): boolean {
  return input.storedMtFingerprint == null || input.currentMtFingerprint !== input.storedMtFingerprint
}

/**
 * Entra na lista do Curador quando defasada E divergente (ambas). Uma linha defasada mas
 * INTOCADA (`isDivergente` falso) é elegível para a re-tradução AUTOMÁTICA (fatia B) — nunca
 * aparece aqui; as duas listas são mutuamente exclusivas por construção (ADR-0031 dec.5/6).
 */
export function isDefasadaEDivergente(input: DivergentStaleInput): boolean {
  return isDefasada(input) && isDivergente(input)
}
