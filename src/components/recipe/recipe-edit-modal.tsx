'use client'
/**
 * Modal CENTRADO de edição IN-PLACE da própria Receita (#192/ADR-0021). A tela de detalhe vira
 * SÓ-LEITURA (estilo Instagram, #161); a edição de CONTEÚDO (título, descrição, ingredientes,
 * passos, facetas) migra de inline para este modal, aberto pelo botão "Editar".
 *
 * Reusa a primitiva `Sheet` (Radix Dialog, #163) na variante `side="center"` — trap de foco,
 * Escape, clique-fora e `role=dialog`/`aria-modal` vêm de graça. O `RecipeEditForm` (que já faz
 * o `PATCH /api/recipes/[id]` IN-PLACE — NUNCA forka — e o Apagar com confirmação) vive DENTRO,
 * fechando o modal via `onSaved` após salvar. O banner de revisão de foto (#131) aparece inline
 * no detalhe atrás, não aqui (a foto é invariante ADR-0016 e fica fora do modal).
 *
 * Escopo desta fatia: SÓ conteúdo + Apagar. Visibilidade-no-modal e "Criar minha versão"/derivar
 * são fatias próprias (#195/#196). O controle de Visibilidade inline do detalhe PERMANECE por ora.
 *
 * O `SheetTitle` nomeia o painel (o form NÃO emite `<h2>` próprio dentro do modal — sem heading
 * duplicado). O Radix desmonta o `SheetContent` ao fechar, então o form re-prefila da `view`
 * (já atualizada pelo `router.refresh`) a cada reabrir — sem rascunho velho preso.
 */
import { useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import type { RecipeView } from '@/domain/recipe-read'
import { RecipeEditForm } from './recipe-edit-form'

export function RecipeEditModal({ view }: { view: RecipeView }) {
  const { messages } = useLocale()
  const m = messages.edicaoPropria
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button">{messages.minhasCriacoes.editar}</Button>
      </SheetTrigger>
      <SheetContent side="center" closeLabel={m.modalFechar}>
        <SheetHeader>
          <SheetTitle>{m.modalTitulo}</SheetTitle>
          <SheetDescription>{m.modalDescricao}</SheetDescription>
        </SheetHeader>
        <RecipeEditForm
          view={view}
          onSaved={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
