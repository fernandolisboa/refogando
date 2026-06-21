import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Alert — primitiva shadcn/ui (ADR-0018): estrutura + a11y do shadcn, pele 100% Refogando.
 * É só estrutura (grid + `role="alert"`), sem Radix → SEM "use client" (roda em RSC).
 *
 * Duas variantes, ambas por token (alias aditivo do globals.css, dark herdado sem `dark:`):
 * - `info`: superfície neutra de massa (`bg-surface`/`border-border`/`text-foreground`).
 * - `aviso`: ÂMBAR de aviso (`bg-aviso-bg`/`text-aviso-fg`, borda âmbar com opacidade) — NUNCA
 *   vermelho. Mapeia o aviso de restrição "declarado-não-verificado" (#7/#57, ver
 *   `recipe/restriction-warning.tsx`): toque leve, informa sem bloquear; o `[&>svg]:text-aviso-fg`
 *   tinge um ícone Lucide opcional na mesma cor do texto.
 *
 * O grid `grid-cols-[0_1fr]` colapsa a coluna do ícone quando não há `<svg>`; com ícone,
 * `has-[>svg]` abre a coluna (largura de 1 unidade de spacing) e o gap. Título e descrição
 * ficam em `col-start-2` (alinhados à direita do ícone). data-slot na convenção shadcn.
 */
const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-md border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5',
  {
    variants: {
      variant: {
        info: 'border-border bg-surface text-foreground',
        aviso:
          'border-aviso-fg/30 bg-aviso-bg text-aviso-fg [&>svg]:text-aviso-fg [&_[data-slot=alert-description]]:text-aviso-fg',
      },
    },
    defaultVariants: {
      variant: 'info',
    },
  },
)

function Alert({
  className,
  variant,
  // `role` é sobrescrevível e default "alert" (live region assertiva — certo p/ erro de submit).
  // Call-sites de INFO não-urgente DEVEM passar role="note"/"status" pra não anunciar de surpresa:
  // o aviso de restrição (#7/#57, ADR-0004) e o stale-notice passam role="note" (informa, não bloqueia).
  role = 'alert',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role={role}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('col-start-2 font-medium tracking-tight', className)}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'col-start-2 text-sm text-muted-foreground [&_p]:leading-relaxed',
        className,
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription }
