import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Badge — primitiva shadcn/ui (ADR-0018): estrutura + a11y do shadcn, pele 100% Refogando.
 * Os tokens quentes da #54 (alias aditivo do globals.css) pintam cada variante; sem `dark:`
 * (os utilitários `bg-surface`/`text-muted-foreground`/`text-brand-ink`/`bg-accent-surface`
 * herdam o dark via @theme inline). NÃO tem "use client": `Slot.Root` é só estrutural (RSC ok).
 *
 * As variantes mapeiam os SELOS DE PROVENIÊNCIA (ver `recipe/provenance-badge.tsx`, a
 * semântica real do domínio): `default` = neutro (Comunidade / `ai_*`), borda + superfície de
 * massa com texto secundário; `catalog` = ERVA, exclusivo de `origin=catalog` (invariante de
 * ADR-0015 — `bg-accent-surface text-accent-strong`, a erva NUNCA aparece fora daqui); `mine`
 * = borda de páprica + texto de marca ("sua receita", #116/own-label), distinto do verde e do
 * neutro sem cor nova; `translation` = discreto "tradução automática" (texto secundário em
 * itálico, sem borda). NÃO existe variante âmbar/aviso aqui de propósito: âmbar é EXCLUSIVO
 * do Alert de restrição (ADR-0015) — um badge nunca é âmbar. `bg-accent`/`bg-muted` nus
 * jamais — a erva é só do selo do Catálogo e `muted` é texto, não superfície.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium transition-colors duration-150 ease-out w-fit whitespace-nowrap shrink-0 [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-border bg-surface text-muted-foreground',
        catalog: 'border-transparent bg-accent-surface text-accent-strong',
        mine: 'border-brand bg-surface text-brand-ink',
        translation: 'border-transparent bg-transparent text-muted-foreground italic font-normal',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span'

  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant, className }))} {...props} />
  )
}

export { Badge, badgeVariants }
