import type { ReactNode } from 'react'

/**
 * Chip de múltipla escolha: um `<input type="checkbox">` nativo (sr-only) dentro de um `<label>` em pílula.
 * O estado marcado/foco vem do próprio input (`has-[:checked]`/`has-[:focus-visible]`), então teclado, leitor
 * de tela e `getByLabelText` funcionam como num checkbox comum. Usado na Sugestão de cardápio e nas
 * Restrições salvas (perfil e "considerar suas restrições").
 */
export function CheckboxChip({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: () => void
  children: ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm text-fg has-[:checked]:border-brand has-[:checked]:bg-brand/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand">
      <input type="checkbox" className="sr-only" checked={checked} onChange={onChange} />
      {children}
    </label>
  )
}
