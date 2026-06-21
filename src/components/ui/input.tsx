import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Input — primitiva shadcn/ui (ADR-0018): estrutura + a11y do shadcn, pele 100% Refogando.
 * É só um <input> nativo estilizado (sem Radix → sem "use client"). A base é o
 * `fieldClassName` da #54 portado pros nomes de token do shadcn (border-input, bg-card,
 * text-foreground, placeholder:text-muted-foreground) — mesmo contraste AA, dark herdado
 * via @theme inline (sem `dark:`). Transição na família dos botões (duration-150 ease-out).
 * Sem classe de foco própria: o :focus-visible global pinta o anel de páprica.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-9 w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-colors duration-150 ease-out placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
