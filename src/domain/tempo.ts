/**
 * Tempo de preparo (#188/#261, ADR-0023) — helpers PUROS das duas facetas (ativo + total).
 *
 * - `conciliarTempoPreparo`: política de salvamento do ADR dec.3 — incoerência `ativo > total`
 *   (ou ativo sem total) ⇒ DESCARTA o ativo, mantém o total. NÃO invalida (tempo é opcional /
 *   baixo-risco). Política UNIFORME: vale pra geração (sobre o par estimado pela IA) e pra edição
 *   (sobre o estado mesclado patch+existente). Garante o CHECK `recipe_tempo_consistency_chk`
 *   antes de qualquer INSERT/UPDATE — nunca deixa o banco rejeitar.
 * - `formatDuracao`: minutos → texto legível ("1 h 30 min" / "45 min" / "2 h"). Unidades h/min são
 *   universais PT/EN; os RÓTULOS ("Tempo ativo" / "Active time") vivem no i18n. Apresentação pura.
 */

export type TempoPreparo = {
  tempoAtivoMin: number | null
  tempoTotalMin: number | null
}

/**
 * Política de salvamento (ADR-0023 dec.3), uniforme entre geração e edição: o tempo ativo só
 * sobrevive se houver um total e o ativo não o exceder; senão é descartado (o total permanece).
 * Nunca invalida a Receita. Idempotente.
 */
export function conciliarTempoPreparo(
  ativo: number | null | undefined,
  total: number | null | undefined,
): TempoPreparo {
  const tempoTotalMin = total ?? null
  const ativoNorm = ativo ?? null
  const tempoAtivoMin =
    ativoNorm != null && (tempoTotalMin == null || ativoNorm > tempoTotalMin) ? null : ativoNorm
  return { tempoAtivoMin, tempoTotalMin }
}

/**
 * Minutos → texto legível ("1 h 30 min" / "45 min" / "2 h"). Omite o componente zero. Ausente
 * (null / ≤ 0) → string vazia (o chamador já condiciona a exibição em `!= null`). Unidades h/min.
 */
export function formatDuracao(min: number | null | undefined): string {
  if (min == null || min <= 0) return ''
  const horas = Math.floor(min / 60)
  const minutos = min % 60
  const partes: string[] = []
  if (horas > 0) partes.push(`${horas} h`)
  if (minutos > 0) partes.push(`${minutos} min`)
  return partes.join(' ')
}
