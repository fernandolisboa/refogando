'use client'
/**
 * #266 (ADR-0021) — apresenta o `CatalogRecipeForm` num DRAWER lateral DIREITO, acionado por um gatilho
 * no painel de Curadoria (antes vivia inline). Espelha o create-drawer público: estado `open`/`loading`
 * no pai, gatilho = botão simples (não `SheetTrigger`), **dismiss BLOQUEADO durante o POST** (o X, o Esc
 * e o clique-fora passam todos por `onOpenChange`/`onEscapeKeyDown`/`onPointerDownOutside`), e
 * **reset-on-reopen AUTOMÁTICO** (o Radix DESMONTA o conteúdo ao fechar ⇒ o form remonta fresco — sem
 * `key`/nonce). Domínio intacto: o form segue POSTando `/api/curate/recipes` (`origin=catalog`).
 */
import { useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { CatalogRecipeForm } from './catalog-recipe-form'

export function CatalogRecipeDrawer() {
  const { messages } = useLocale()
  const m = messages.curadoria
  const [open, setOpen] = useState(false)
  // #266: POST em voo (sinalizado pelo form via onLoadingChange) ⇒ bloqueia o dismiss.
  const [loading, setLoading] = useState(false)

  function handleOpenChange(next: boolean) {
    // Dismiss BLOQUEADO durante o POST: qualquer fechamento (X/Esc/clique-fora) é no-op enquanto envia.
    if (!next && loading) return
    if (!next) setLoading(false)
    setOpen(next)
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {m.criarReceitaBotao}
      </Button>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          closeLabel={m.criarReceitaFechar}
          className="w-full gap-6 overflow-y-auto sm:max-w-lg"
          // Espelha o create-drawer (ADR-0021 dec.5): Esc e clique-fora NÃO fecham com o POST em voo.
          onEscapeKeyDown={(e) => {
            if (loading) e.preventDefault()
          }}
          onPointerDownOutside={(e) => {
            if (loading) e.preventDefault()
          }}
        >
          <SheetHeader>
            {/* O título + descrição vivem aqui (o form não tem mais cabeçalho próprio): um único título
                VISÍVEL, que também é o nome acessível do dialog (Radix aria-labelledby). */}
            <SheetTitle>{m.criarReceitaTitulo}</SheetTitle>
            <SheetDescription>{m.criarReceitaDescricao}</SheetDescription>
          </SheetHeader>
          <CatalogRecipeForm onLoadingChange={setLoading} />
        </SheetContent>
      </Sheet>
    </>
  )
}
