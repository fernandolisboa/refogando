'use client'
/**
 * Contexto do vocabulário de cozinha localizado (#317, ADR-0025).
 *
 * Os forms (Busca/Criar/Editar/Catálogo) e os previews de geração recebem as opções de
 * cozinha do MESMO jeito que já recebem `messages`: um contexto semeado no servidor. O
 * layout (`[locale]/layout.tsx`) resolve `loadVocabulary('cozinha','active')` UMA vez, no
 * ancestral comum de TODA rota, e passa o array já localizado aqui — o cliente nunca vê os
 * dois rótulos crus nem faz lógica de locale (isso vive em `domain/cozinha-label.ts`).
 *
 * DEFAULT GRACIOSO: sem provider montado, `useCozinhaVocab()` devolve `[]` (NÃO lança). Isso
 * mantém verde os testes de UI que montam só o `LocaleProvider` (a faceta de cozinha apenas
 * renderiza vazia ali) e degrada de forma segura se o layout falhar ao semear (ver o try/catch
 * do layout: um soluço do Neon vira `[]`, não uma tela quebrada na raiz do app).
 */
import { createContext, useContext, type ReactNode } from 'react'
import type { CozinhaOption } from '@/domain/cozinha-label'

// Default = [] (não null): sem provider, a faceta de cozinha some em vez de explodir.
const CozinhaVocabContext = createContext<readonly CozinhaOption[]>([])

export function CozinhaVocabProvider({
  value,
  children,
}: {
  value: readonly CozinhaOption[]
  children: ReactNode
}) {
  return <CozinhaVocabContext.Provider value={value}>{children}</CozinhaVocabContext.Provider>
}

export function useCozinhaVocab(): readonly CozinhaOption[] {
  return useContext(CozinhaVocabContext)
}
