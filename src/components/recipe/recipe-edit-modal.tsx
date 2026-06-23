'use client'
/**
 * Modal CENTRADO de edição IN-PLACE da própria Receita (#192/ADR-0021). A tela de detalhe vira
 * SÓ-LEITURA (estilo Instagram, #161); a edição de CONTEÚDO (título, descrição, ingredientes,
 * passos, facetas) migra de inline para este modal, aberto pelo botão "Editar".
 *
 * Reusa a primitiva `Sheet` (Radix Dialog, #163) na variante `side="center"` — `role=dialog`,
 * trap de foco, overlay, Escape e clique-fora vêm de graça; o nome acessível vem do `SheetTitle`
 * (aria-labelledby). O `RecipeEditForm` (que já faz
 * o `PATCH /api/recipes/[id]` IN-PLACE — NUNCA forka — e o Apagar com confirmação) vive DENTRO,
 * fechando o modal via `onSaved` após salvar. O banner de revisão de foto (#131) aparece inline
 * no detalhe atrás, não aqui (a foto é invariante ADR-0016 e fica fora do modal).
 *
 * Escopo desta fatia: conteúdo + Apagar + Visibilidade (#195). O modal agora hospeda o toggle de
 * Visibilidade como rascunho local que só comita no Salvar — via publish/unpublish SEPARADO do
 * PATCH de conteúdo, mantendo a fronteira owner-edit. O detalhe deixou de ter controle inline e
 * passou a um chip de status NÃO-clicável (só-leitura).
 *
 * #196/ADR-0021: o MESMO modal abre numa Receita NÃO-própria com `mode="derive"`. O gatilho é
 * "Criar minha versão" e o Salvar DERIVA (POST /api/recipes/[id]/derive — nunca PATCH; a base
 * NUNCA é mutada) e navega pra nova Receita (sua, privada). No modo derive o toggle de
 * Visibilidade e o Apagar ficam ESCONDIDOS: a derivada ainda NÃO existe (sem id pra
 * publish/unpublish) e a base não é sua — ela nasce privada e o Usuário publica depois, no
 * detalhe dela. O `locale` é passado pro form (o POST /derive carrega `?locale`).
 *
 * O `SheetTitle` nomeia o painel (o form NÃO emite `<h2>` próprio dentro do modal — sem heading
 * duplicado). O Radix desmonta o `SheetContent` ao fechar, então o form re-prefila da `view`
 * (já atualizada pelo `router.refresh`) a cada reabrir — sem rascunho velho preso.
 *
 * #197 (fix da regressão de perda-de-dados): o diálogo de confirmação INTERNO do form (apagar /
 * editar pública) empilha SOBRE este Sheet. O Radix escuta o Escape em CAPTURE no document e
 * fecharia o Sheet inteiro (descartando o rascunho) ANTES do handler do confirm. Por isso o form
 * sinaliza `onConfirmOpenChange`; enquanto o confirm está aberto, `onEscapeKeyDown` e
 * `onPointerDownOutside` do `SheetContent` chamam `preventDefault()` — o Escape/click-fora só
 * fecha o confirm (camada de cima), nunca o modal.
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

/**
 * `mode='own'` (default): editar IN-PLACE a própria Receita (gatilho "Editar", PATCH).
 * `mode='derive'` (#196): derivar uma Receita NÃO-própria (gatilho "Criar minha versão", POST
 * /derive). `locale` só é usado no modo derive (o POST carrega `?locale`); no own o form usa o
 * locale atual do provider.
 */
export function RecipeEditModal({
  view,
  mode = 'own',
  locale,
}: {
  view: RecipeView
  mode?: 'own' | 'derive'
  locale?: string
}) {
  const { messages } = useLocale()
  const m = messages.edicaoPropria
  const isDerive = mode === 'derive'
  const [open, setOpen] = useState(false)
  // #197: enquanto o confirm interno do form está aberto, o Sheet IGNORA o Escape/click-fora
  // (o confirm — camada de cima — os consome), pra não fechar o modal e perder o rascunho.
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button">
          {isDerive ? messages.minhasCriacoes.criarMinhaVersao : messages.minhasCriacoes.editar}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="center"
        closeLabel={m.modalFechar}
        onEscapeKeyDown={(e) => {
          if (confirmOpen) e.preventDefault()
        }}
        onPointerDownOutside={(e) => {
          if (confirmOpen) e.preventDefault()
        }}
      >
        <SheetHeader>
          <SheetTitle>{isDerive ? m.modalDerivarTitulo : m.modalTitulo}</SheetTitle>
          <SheetDescription>
            {isDerive ? m.modalDerivarDescricao : m.modalDescricao}
          </SheetDescription>
        </SheetHeader>
        <RecipeEditForm
          view={view}
          mode={mode}
          locale={locale}
          onSaved={() => setOpen(false)}
          onCancel={() => setOpen(false)}
          onConfirmOpenChange={setConfirmOpen}
        />
      </SheetContent>
    </Sheet>
  )
}
