'use client'
/**
 * Estado COMPARTILHADO do termo de busca da home (#5 — protótipo "feed editorial").
 *
 * O protótipo final põe a caixa de busca DENTRO do `<header>` (segunda linha, sob a wordmark/nav),
 * mas o cérebro da Busca (`SearchExperience`, que provê o `<main>`) é IRMÃO do `SiteHeader` no
 * layout. Para o pill viver no header E o termo continuar dirigindo a busca, elevamos SÓ o `q` (o
 * termo) a este contexto, semeado no `[locale]/layout.tsx` em volta do header + dos children. Todo
 * o resto do estado da Busca (facetas, resultados, web, cooks) permanece em `SearchExperience`.
 *
 * - `HomeSearchBar` (a pílula, renderizada como linha 2 do `SiteHeader` SÓ na home) lê/escreve `q`.
 * - `SearchExperience` consome `q` no lugar do `useState` local e REGISTRA seu `doSearch` como
 *   `submit` (o Enter no header continua disparando a busca SEM esperar o debounce de 300ms).
 *
 * DEFAULT GRACIOSO (espelha `useCozinhaVocab`): sem provider montado, `useHomeSearch()` devolve um
 * valor INERTE (`q=''`, setters no-op) e NUNCA lança. Isso mantém verde os testes que montam só o
 * `SiteHeader` (shell/criar/mobile/painel) e o SSR da Home no teste de integração (que envolve a
 * página só no LocaleProvider) — sem o provider, o header simplesmente não tem uma busca funcional.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type HomeSearchValue = {
  q: string
  setQ: (value: string) => void
  /** Dispara a busca imediatamente (Enter no pill) — bypassa o debounce, como o `onSubmit` de antes. */
  submit: () => void
  /** `SearchExperience` registra seu `doSearch` aqui; o `submit()` do pill o invoca. */
  registerSubmit: (fn: () => void) => void
}

const noop = () => {}

// Default INERTE (não null): sem provider, o header não busca, mas nada explode.
const HomeSearchContext = createContext<HomeSearchValue>({
  q: '',
  setQ: noop,
  submit: noop,
  registerSubmit: noop,
})

export function HomeSearchProvider({ children }: { children: ReactNode }) {
  const [q, setQ] = useState('')
  // Ref pro `doSearch` corrente de `SearchExperience` (identidade muda com os deps do useCallback).
  // O pill chama `submit()`; aqui só repassamos pro handler registrado (no-op enquanto não há um).
  const submitRef = useRef<() => void>(noop)
  const submit = useCallback(() => submitRef.current(), [])
  const registerSubmit = useCallback((fn: () => void) => {
    submitRef.current = fn
  }, [])
  // `setQ` do useState já é estável; `submit`/`registerSubmit` são useCallback estáveis ⇒ o value
  // só muda quando `q` muda (evita re-render desnecessário dos consumidores).
  const value = useMemo<HomeSearchValue>(
    () => ({ q, setQ, submit, registerSubmit }),
    [q, submit, registerSubmit],
  )
  return <HomeSearchContext.Provider value={value}>{children}</HomeSearchContext.Provider>
}

export function useHomeSearch(): HomeSearchValue {
  return useContext(HomeSearchContext)
}
