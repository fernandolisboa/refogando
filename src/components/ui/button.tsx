import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Button — primitiva shadcn/ui (ADR-0018): estrutura + a11y do shadcn, pele 100% Refogando.
 * Os tokens quentes da #54 (alias aditivo do globals.css) pintam cada variante; sem `dark:`
 * (os utilitários `bg-primary`/`bg-destructive`/`text-brand-ink` herdam o dark via @theme inline).
 * NÃO tem "use client": `Slot.Root` é só estrutural e funciona em RSC.
 *
 * Variantes mapeiam o vocabulário canônico de `button.ts` (que isto deprecia): `default` =
 * `btnPrimary` (páprica de FUNDO), `secondary`/`outline` = borda que vira `brand-ink` no hover,
 * `ghost` = lavagem de páprica `bg-brand/10` (NUNCA `bg-accent` — erva é só do selo do Catálogo),
 * `destructive` = âmbar de aviso (nunca vermelho), `link` = texto de marca sublinhado.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors duration-150 ease-out disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:opacity-90',
        secondary:
          'border border-border bg-secondary text-secondary-foreground hover:border-brand-ink',
        outline:
          'border border-border bg-transparent text-foreground hover:border-brand-ink hover:bg-brand/10',
        ghost: 'text-foreground hover:bg-brand/10',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:opacity-90',
        link: 'text-brand-ink underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3.5 py-1.5 text-sm',
        default: 'h-9 px-4 py-2',
        lg: 'h-10 px-5 py-2.5',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
