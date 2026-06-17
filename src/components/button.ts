/**
 * Vocabulário canônico de ação (issue #54) — fonte ÚNICA do estilo de botão primário e
 * secundário, pra não recopiar (e divergir, como já tinha acontecido entre o retry de erro
 * e o AuthSlot). São strings de `className` pra compor em `<button>` OU `<Link>` sem
 * introduzir mais um wrapper de componente. Cores via token (brand-strong = FUNDO;
 * brand-ink = realce de borda no hover, perceptível também no dark).
 */
const base =
  'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors duration-150 ease-out'

export const btnPrimary = `${base} bg-brand-strong px-4 py-2 text-on-brand shadow-sm hover:opacity-90`

/** Variante compacta (ex.: pill no header). Mesma identidade, só o tamanho muda. */
export const btnPrimarySm = `${base} bg-brand-strong px-3.5 py-1.5 text-on-brand shadow-sm hover:opacity-90`

export const btnSecondary = `${base} border border-border bg-surface px-4 py-2 text-fg hover:border-brand-ink`
