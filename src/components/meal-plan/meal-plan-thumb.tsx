/**
 * Miniatura quadrada de Receita do Cardápio (linha do dia e seletor): a imagem, ou o placeholder
 * da casa, com o selo "gerada por IA" sobreposto quando a imagem é gerada (ADR-0017 — o selo vale em
 * toda superfície do app; mesmo desenho do `CookCard`).
 */
import { ImageIcon, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

export function MealPlanThumb({
  imageUrl,
  aiGenerated,
  aiLabel,
  className,
}: {
  imageUrl?: string
  aiGenerated?: boolean
  aiLabel: string
  className?: string
}) {
  return (
    <span className={cn('relative block shrink-0', className)}>
      {imageUrl != null ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          className="size-full rounded-md border border-border object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="flex size-full items-center justify-center rounded-md border border-border bg-brand/[0.07] text-brand/40"
        >
          <ImageIcon className="size-4" strokeWidth={1.5} />
        </span>
      )}
      {imageUrl != null && aiGenerated && (
        <span className="absolute right-0.5 bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-bg text-brand shadow-sm">
          <Sparkles className="size-2.5" strokeWidth={2} aria-hidden />
          <span className="sr-only">{aiLabel}</span>
        </span>
      )}
    </span>
  )
}
