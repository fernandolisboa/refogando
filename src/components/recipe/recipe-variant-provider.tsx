'use client'
/**
 * Contexto da disponibilidade da VARIAÇÃO DE GERAÇÃO ("gerar 2, o usuário escolhe" — #423, ADR-0029
 * dec.6).
 *
 * O opt-in "Gerar 2 versões" só aparece quando o admin LIGOU a feature (`app_config.recipe_variant.
 * enabled`). Como o drawer de criação abre CLIENT-SIDE (do nav, sem round-trip de servidor), o flag é
 * semeado no MESMO ancestral comum que o vocabulário de cozinha: o layout (`[locale]/layout.tsx`)
 * resolve `loadRecipeVariantConfig` UMA vez e passa só o boolean aqui — o cliente nunca vê pólos/
 * instrução (isso é do admin/servidor) nem faz fetch por montagem.
 *
 * DEFAULT GRACIOSO: sem provider montado, `useRecipeVariantEnabled()` devolve `false` (NÃO lança) — o
 * checkbox some. Mantém verde os testes de UI que montam só o `LocaleProvider` e degrada seguro se o
 * layout falhar ao semear. O SERVIDOR é a verdade de qualquer forma (ignora `variar2` com a config
 * desligada), então um flag stale no cliente nunca gera 2 sem a feature ligada.
 */
import { createContext, useContext, type ReactNode } from 'react'

const RecipeVariantContext = createContext<boolean>(false)

export function RecipeVariantProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <RecipeVariantContext.Provider value={enabled}>{children}</RecipeVariantContext.Provider>
}

export function useRecipeVariantEnabled(): boolean {
  return useContext(RecipeVariantContext)
}
