'use client'

/**
 * Alvo de planejamento da criação (ADR-0040): a rota `/create` lê `?planDay&planSlot` (vindos do
 * "Criar receita nova" do Cardápio) e o expõe aqui, para o resultado da geração oferecer "Pôr no
 * cardápio: terça, jantar" sem descer a prop pelo drawer e pelos dois caminhos de criação. Fora da
 * `/create` (o drawer aberto pelo botão "Criar" do topo) não há provedor: o alvo é `null`.
 */
import { createContext, useContext } from 'react'
import type { MealPlanTarget } from '@/domain/meal-plan'

const MealPlanTargetContext = createContext<MealPlanTarget | null>(null)

export const MealPlanTargetProvider = MealPlanTargetContext.Provider

export function useMealPlanTarget(): MealPlanTarget | null {
  return useContext(MealPlanTargetContext)
}
