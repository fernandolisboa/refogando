'use client'

/**
 * Escolha da CATEGORIA do motivo de uma retirada (#609) — compartilhada pela fila de moderação e pela fila de revisão
 * de imagens. Lista fechada (`MODERATION_CATEGORIES`); o dono vê a categoria escolhida na notificação. O texto de ajuda
 * diz também que o motivo livre logo abaixo fica fora da notificação, mas sai na exportação dos dados do dono, então não
 * deve citar terceiros (quem denunciou, por exemplo).
 *
 * `<select>` nativo, como os demais filtros do Console (users-section): acessível por teclado sem primitiva nova. A
 * opção vazia é o estado inicial; o botão de remover só habilita com uma categoria e o servidor reimpõe (400
 * `categoria_invalida`). Rótulos via `categoriaModeracaoLabel` (`satisfies Record<ModerationCategory, string>`).
 */
import { useLocale } from '@/i18n/provider'
import { MODERATION_CATEGORIES, isModerationCategory, type ModerationCategory } from '@/domain/moderation-category'

export function ModerationCategorySelect({
  id,
  value,
  onChange,
  label,
  placeholder,
  hint,
}: {
  /** Prefixo único por card (o id do item), base do `aria-describedby`. */
  id: string
  value: ModerationCategory | ''
  onChange: (value: ModerationCategory | '') => void
  label: string
  placeholder: string
  hint: string
}) {
  const { messages } = useLocale()
  const labels = messages.categoriaModeracaoLabel
  const hintId = `${id}-categoria-ajuda`
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-sm font-medium text-fg">
        {label}
        <select
          value={value}
          onChange={(e) => onChange(isModerationCategory(e.target.value) ? e.target.value : '')}
          required
          aria-required="true"
          aria-describedby={hintId}
          className="h-9 rounded-md border border-border bg-bg px-2 text-sm font-normal text-fg"
        >
          <option value="">{placeholder}</option>
          {MODERATION_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {labels[c]}
            </option>
          ))}
        </select>
      </label>
      <p id={hintId} className="text-xs text-muted">
        {hint}
      </p>
    </div>
  )
}
