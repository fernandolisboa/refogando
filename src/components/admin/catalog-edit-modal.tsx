'use client'
/**
 * Modal de edição de um rascunho de CATÁLOGO na fila de curadoria (#238, ADR-0026 emenda dec.9).
 * Reusa o EDITOR RICO (`RecipeEditForm` com `mode='catalog'`) — ingredientes estruturados, facetas,
 * tempos, validação, a11y — em vez de um form inline novo. Controlado pela fila (open/onOpenChange);
 * o Salvar bate na rota de CURADOR e, no sucesso, `onSaved` recarrega o item na fila. Espelha o
 * `RecipeEditModal` do detalhe (Sheet center), mas controlado e sem o gatilho próprio.
 */
import { useState } from 'react'
import { useLocale } from '@/i18n/provider'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import type { RecipeView } from '@/domain/recipe-read'
import { RecipeEditForm } from '@/components/recipe/recipe-edit-form'

export function CatalogEditModal({
  view,
  open,
  onOpenChange,
  onSaved,
}: {
  view: RecipeView
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { messages } = useLocale()
  const m = messages.curadoria
  // O form sinaliza confirm-aberto pra cima (#197). No modo catálogo não há confirm (sem publish/
  // delete), mas mantemos o contrato (no-op funcional — `confirmOpen` fica sempre false).
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="center"
        closeLabel={messages.edicaoPropria.modalFechar}
        onEscapeKeyDown={(e) => {
          if (confirmOpen) e.preventDefault()
        }}
        onPointerDownOutside={(e) => {
          if (confirmOpen) e.preventDefault()
        }}
      >
        <SheetHeader>
          <SheetTitle>{m.filaEditarTitulo}</SheetTitle>
          <SheetDescription>{m.filaEditarDescricao}</SheetDescription>
        </SheetHeader>
        <RecipeEditForm
          view={view}
          mode="catalog"
          onSaved={onSaved}
          onCancel={() => onOpenChange(false)}
          onConfirmOpenChange={setConfirmOpen}
        />
      </SheetContent>
    </Sheet>
  )
}
