'use client'
/**
 * "Considerar suas restrições" (ADR-0041) — os caminhos SEM campo de restrição (Prompt aberto e Conversa)
 * mostram as Restrições SALVAS no perfil como chips já marcados; tocar num tira-o DESTE pedido. Só aparece
 * quando há algo salvo: quem não salvou nada vê a tela exatamente como antes. Não oferece o vocabulário
 * inteiro de propósito (aí já seria o Formulário estruturado) — uma restrição a mais vai no próprio texto.
 */
import { useId } from 'react'
import { useLocale } from '@/i18n/provider'
import { CheckboxChip } from '@/components/ui/checkbox-chip'
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
  const dicaId = useId()
  if (perfil == null || perfil.length === 0) return null
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled} aria-describedby={dicaId}>
      <legend className="mb-1 text-sm font-medium text-fg">{m.considerarLegenda}</legend>
      <div className="flex flex-wrap gap-2">
        {perfil.map((r) => (
          <CheckboxChip key={r} checked={selecionadas.includes(r)} onChange={() => onToggle(r)}>
            {messages.restricaoLabel[r]}
          </CheckboxChip>
        ))}
      </div>
      <p id={dicaId} className="text-xs text-muted">
        {m.considerarDica}
      </p>
    </fieldset>
  )
}
