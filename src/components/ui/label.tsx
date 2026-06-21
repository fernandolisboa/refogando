'use client'

import { Label as LabelPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

/**
 * `Label` — primitiva shadcn/ui (ADR-0018): estrutura + a11y do Radix Label
 * (associa-se ao controle via `htmlFor`/clique propaga o foco), pintada com os
 * tokens quentes da #54. `peer-disabled:*` espelha o estado desabilitado do
 * controle irmão marcado com `peer`. Sem `dark:` — os tokens viram sozinhos.
 */
function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm font-medium text-foreground leading-none select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  )
}

export { Label }
