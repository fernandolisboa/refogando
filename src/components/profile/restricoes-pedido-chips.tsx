'use client'
/**
 * "Considerar suas restrições" (ADR-0041) — os caminhos SEM campo de restrição (Prompt aberto e Conversa)
 * mostram as Restrições SALVAS no perfil como chips já marcados; tocar num tira-o DESTE pedido. Só aparece
 * quando há algo salvo: quem não salvou nada vê a tela exatamente como antes. Não oferece o vocabulário
 * inteiro de propósito (aí já seria o Formulário estruturado) — uma restrição a mais vai no próprio texto.
 */
import { useLocale } from '@/i18n/provider'
import type { Restricao } from '@/domain/vocabulary'

export function RestricoesPedidoChips({
  perfil,
  selecionadas,
  onToggle,
  disabled = false,
}: {
  /** As salvas no perfil (as opções). `null`/vazio ⇒ não renderiza. */
  perfil: readonly Restricao[] | null
  /** As que valem neste pedido. */
  selecionadas: readonly Restricao[]
  onToggle: (r: Restricao) => void
  disabled?: boolean
}) {
  const { messages } = useLocale()
  const m = messages.restricoesPerfil
  if (perfil == null || perfil.length === 0) return null
  const chipClass =
    'flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm text-fg has-[:checked]:border-brand has-[:checked]:bg-brand/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand'
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium text-fg">{m.considerarLegenda}</legend>
      <div className="flex flex-wrap gap-2">
        {perfil.map((r) => (
          <label key={r} className={chipClass}>
            <input
              type="checkbox"
              className="sr-only"
              checked={selecionadas.includes(r)}
              onChange={() => onToggle(r)}
            />
            {messages.restricaoLabel[r]}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted">{m.considerarDica}</p>
    </fieldset>
  )
}
