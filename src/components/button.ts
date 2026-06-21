/**
 * Vocabulário canônico de CAMPO (issue #54) — depois da migração dos botões para a primitiva
 * `<Button>` (ADR-0018), este módulo guarda APENAS o `className` de campo (input/select/textarea)
 * para os `<select>` nativos remanescentes. Os antigos exports `btnPrimary`/`btnSecondary` (e suas
 * variantes `Sm`) foram removidos por já não terem leitores.
 *
 * String de `className` para compor (fonte única, sem wrapper). Os tokens (border-border,
 * bg-surface, text-fg, placeholder:text-muted) já têm contraste AA verificado na #54.
 */
export const fieldClassName =
  'rounded-md border border-border bg-surface px-3 py-2 text-fg shadow-sm placeholder:text-muted'
