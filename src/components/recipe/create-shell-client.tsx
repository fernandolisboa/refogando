'use client'
/**
 * Shell client da rota `/create` (#191, ADR-0021 dec. 2). A tela de página inteira morreu; a
 * rota vira um SHELL FINO que ABRE o drawer "Nova receita", semeado pelos deep-links que já
 * existiam — `?q` (ponte "gerar com IA" da Busca, #166 → Prompt aberto preenchido), `?resume`
 * e `?mode=conversa` (retomada de Conversa). A URL e seus três deep-links SOBREVIVEM.
 * ADR-0040 somou `?planDay&planSlot` (o alvo do Cardápio), que não muda o drawer: só o resultado
 * da geração lê, via `MealPlanTargetProvider`.
 *
 * `useSearchParams` é o motivo do `<Suspense>` no Server Component pai (exigência do Next para
 * leitura de search params no build de produção). Fechar o drawer aqui não navega para lugar
 * nenhum — o usuário fica na `/create` com o drawer fechado (a chrome do shell por baixo).
 */
import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { parseMealPlanTarget } from '@/domain/meal-plan'
import { MealPlanTargetProvider } from '@/components/meal-plan/meal-plan-target-context'
import { CreateDrawer } from './create-drawer'

export function CreateShellClient() {
  const params = useSearchParams()
  const initialQ = params.get('q') ?? undefined
  const resume = params.get('resume') ?? undefined
  const conversaHint = params.get('mode') === 'conversa'
  // ADR-0040: "Criar receita nova" de uma refeição do Cardápio — o resultado oferece pôr a Receita lá.
  const planDay = params.get('planDay')
  const planSlot = params.get('planSlot')
  const planTarget = useMemo(() => parseMealPlanTarget(planDay, planSlot), [planDay, planSlot])

  // O drawer abre ao montar a rota /create. Fechá-lo NÃO navega (fica na /create).
  const [open, setOpen] = useState(true)

  return (
    <MealPlanTargetProvider value={planTarget}>
      <CreateDrawer
        open={open}
        onOpenChange={setOpen}
        initialQ={initialQ}
        resumeSessionId={resume}
        conversaHint={conversaHint}
      />
    </MealPlanTargetProvider>
  )
}
