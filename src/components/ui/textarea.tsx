import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Textarea (shadcn/ui, ADR-0018) — estrutura padrão do shadcn pintada com os tokens
 * quentes da #54. Mesma família visual do `<Input>`/`fieldClassName`, mas de altura
 * mínima maior (`min-h-16`). NÃO usa `field-sizing-content`: os call-sites legados
 * definem a altura inicial via `rows={N}`, e `field-sizing:content` ignora o `rows`
 * (colapsando campos grandes ao piso de 64px no render inicial).
 * Presentacional puro (sem Radix), então NÃO leva "use client". Foco fica a cargo do
 * `:focus-visible` global (anel de páprica) — sem ring custom aqui.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-16 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-colors duration-150 ease-out placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
