'use client'

import * as React from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

/**
 * Popover — primitiva shadcn/ui sobre o Radix Popover (monopacote `radix-ui`), pintada com os
 * tokens quentes da casa (ADR-0018), espelhando `dropdown-menu.tsx`. Diferença vs. DropdownMenu:
 * NÃO é `role=menu` (sem typeahead que roubaria as teclas de um `<input>` interno) — é o container
 * certo pra um FORMULÁRIO flutuante (ex.: o picker de Coleção do detalhe). O Radix dá a a11y de
 * overlay de graça: `aria-haspopup`/`aria-expanded` no gatilho, Escape fecha, clique-fora fecha
 * (DismissableLayer), foco volta ao gatilho ao fechar. `PopoverContent` SEMPRE entra num `Portal`
 * (igual `DropdownMenuContent`/`SheetContent`). Sem `dark:` (tokens viram sozinhos via globals.css);
 * NUNCA a erva `accent` (reservada ao selo do Catálogo).
 */

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = 'end',
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverContent }
