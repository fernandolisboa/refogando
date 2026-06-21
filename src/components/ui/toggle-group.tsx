'use client'

/**
 * ToggleGroup (shadcn/ui — ADR-0018): estrutura + a11y do Radix, pele 100% Refogando.
 * Segmented control — substitui o par à-mão de `src/components/recipe/sort-toggle.tsx`
 * (ativo `btnPrimarySm` ↔ inativo `btnSecondarySm`). O item parte do secundário
 * (`bg-surface` + `border-border`, hover acende a `border-brand-ink`) e ativo vira
 * páprica (`bg-primary` + `text-primary-foreground` + `border-transparent` + `shadow-sm`)
 * via `data-[state=on]` — mesmo padding nos dois estados, então a seleção NÃO SALTA.
 * Sem `dark:` (os tokens viram no globals.css) e sem focus ring custom (o `:focus-visible`
 * global já pinta o anel de páprica). NUNCA accent (Catálogo) nem âmbar (Aviso).
 *
 * CUIDADO de contrato (Radix `type="single"`): a seleção é DESmarcável — clicar no item
 * ativo emite onValueChange(""). Para um segmented control sempre-selecionado (SortToggle),
 * envolva e descarte o "" (ver o wrapper em recipe/sort-toggle.tsx).
 */
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn('inline-flex items-center gap-1 rounded-md', className)}
      {...props}
    />
  )
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        'inline-flex items-center justify-center rounded-md border border-border bg-surface px-3.5 py-1.5 text-sm font-medium text-foreground transition-colors duration-150 ease-out hover:border-brand-ink disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:border-transparent data-[state=on]:shadow-sm data-[state=on]:hover:border-transparent',
        className,
      )}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
