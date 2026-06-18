/**
 * Aviso de contradição de restrição (#7/#57) — componente PURO, sem hooks. Recebe um
 * `AvisoView` (a `mensagem` JÁ vem renderizada no locale pela rota) + `title` (rótulo de
 * a11y). Toque LEVE (CONTEXT.md): informa, NUNCA bloqueia/suprime/gateia a leitura.
 *
 * `role="note"` (não `role="alert"`): é leitura leve, não interrompe o leitor de tela.
 * Token ÂMBAR `bg-aviso-bg`/`text-aviso-fg` (par AA já verificado na #54, ADR-0004). A
 * borda usa o MESMO token âmbar com opacidade (decorativa) — nenhuma cor nova.
 */
import type { AvisoView } from '@/domain/recipe-read'

export function RestrictionWarning({ aviso, title }: { aviso: AvisoView; title: string }) {
  return (
    <div
      role="note"
      aria-label={title}
      className="rounded-md border border-aviso-fg/30 bg-aviso-bg px-4 py-3 text-aviso-fg"
    >
      <p className="text-sm">{aviso.mensagem}</p>
    </div>
  )
}
