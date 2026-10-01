'use client'

/**
 * Botão "Adicionar ao cardápio" do detalhe (ADR-0035 dec.4) — ícone de calendário no topo, ao lado
 * do carrinho da Lista de compras e do bookmark de Salvar, MESMO padrão visual (ícone + Popover
 * ancorado). Escolhe o dia (os próximos 7, a partir de HOJE no fuso do navegador — dec.2) e a
 * refeição, e planeja com um toque.
 *
 * PORÇÕES: como o carrinho (`RecipeShoppingListButton`), NÃO tem campo próprio — reusa o valor
 * corrente do escalador da página (`usePortionScale`); o que a pessoa vê na tela é o que vai pro
 * cardápio. Só manda `porcoes` quando a Receita DECLARA porções (sem isso o escalador nem monta e o
 * contexto ocioso diria 1).
 */
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarPlus } from 'lucide-react'
import { useSession } from '@/lib/auth-client'
import { useLocale } from '@/i18n/provider'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { usePortionScale } from './recipe-portion-scale-context'
import { PlanRecipePanel } from '@/components/meal-plan/plan-recipe-panel'

const ICON_BUTTON =
  'inline-flex size-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-brand/10 hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40'

export function RecipeMealPlanButton({
  recipeId,
  porcoesReceita,
}: {
  recipeId: string
  porcoesReceita: number | null
}) {
  const { messages } = useLocale()
  const m = messages.cardapio
  const session = useSession()
  const pathname = usePathname()
  const { porcoes } = usePortionScale()
  const [open, setOpen] = useState(false)

  if (session.isPending) return null
  const loggedIn = !session.error && !!session.data

  if (!loggedIn) {
    return (
      <Link
        href={`/sign-in?returnTo=${encodeURIComponent(pathname ?? '/')}`}
        aria-label={m.convidaEntrar}
        className={ICON_BUTTON}
      >
        <CalendarPlus className="size-5" strokeWidth={1.5} aria-hidden />
      </Link>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={m.planejarReceita}
          aria-expanded={open}
          className={cn(ICON_BUTTON)}
        >
          <CalendarPlus className="size-5" strokeWidth={1.5} aria-hidden />
        </button>
      </PopoverAnchor>
      <PopoverContent>
        <PlanRecipePanel recipeId={recipeId} porcoes={porcoesReceita != null ? porcoes : null} />
      </PopoverContent>
    </Popover>
  )
}
