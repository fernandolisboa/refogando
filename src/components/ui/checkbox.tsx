'use client'

/**
 * Checkbox (shadcn/ui — ADR-0018): estrutura + a11y do Radix, pele 100% Refogando.
 * A caixa parte de `bg-card` com `border-input`; marcada vira páprica (`bg-primary` +
 * `border-primary` + `text-primary-foreground`) via `data-[state=checked]`. Sem `dark:`
 * e sem focus ring custom: os tokens viram no globals.css e o `:focus-visible` global já
 * pinta o anel de páprica. O check é o ícone Lucide, traço encorpado.
 */
import { Checkbox as CheckboxPrimitive } from 'radix-ui'
import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-4 shrink-0 rounded-sm border border-input bg-card shadow-sm transition-colors duration-150 ease-out data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
