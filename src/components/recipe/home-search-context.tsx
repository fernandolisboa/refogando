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
 * - `HomeSearchBar` (a pílula, inline no header em telas largas, 2ª linha abaixo) lê/escreve `q`.
 * - `SearchExperience` consome `q` no lugar do `useState` local e REGISTRA seu `doSearch` como
 *   `submit` (o Enter no header continua disparando a busca SEM esperar o debounce de 300ms).
 * - `wide` (3 colunas, ADR-0024 emendado): `SearchExperience` AVISA quando a home abre as 3 colunas das
 *   telas largas (logado + repouso + ≥MIN cozinheiros), pra o `SiteHeader` ALARGAR junto (`xl:max-w-wide`)
 *   e a chrome alinhar com as colunas do corpo (mesmas margens do mock). Anon/busca ⇒ `false` ⇒ header
 *   segue na largura `page` APROVADA (sem regressão).
 *
 * DEFAULT GRACIOSO (espelha `useCozinhaVocab`): sem provider montado, `useHomeSearch()` devolve um
 * valor INERTE (`q=''`, `wide=false`, setters no-op) e NUNCA lança. Isso mantém verde os testes que montam
 * só o `SiteHeader` (shell/criar/mobile/painel) e o SSR da Home no teste de integração (que envolve a
 * página só no LocaleProvider) — sem o provider, o header simplesmente não tem busca/largura funcionais.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type HomeSearchValue = {
  q: string
  setQ: (value: string) => void
  /** Dispara a busca imediatamente (Enter no pill) — bypassa o debounce, como o `onSubmit` de antes. */
  submit: () => void
  /** `SearchExperience` registra seu `doSearch` aqui; o `submit()` do pill o invoca. */
  registerSubmit: (fn: () => void) => void
  /** A home está em 3 colunas (telas largas)? O `SiteHeader` alarga junto (`xl:max-w-wide`) p/ alinhar. */
  wide: boolean
  /** `SearchExperience` avisa quando entra/sai do layout de 3 colunas. */
  setWide: (value: boolean) => void
}

const noop = () => {}

// Default INERTE (não null): sem provider, o header não busca nem alarga, mas nada explode.
const HomeSearchContext = createContext<HomeSearchValue>({
  q: '',
  setQ: noop,
  submit: noop,
  registerSubmit: noop,
  wide: false,
  setWide: noop,
})

export function HomeSearchProvider({ children }: { children: ReactNode }) {
  const [q, setQ] = useState('')
  const [wide, setWide] = useState(false)
  // Ref pro `doSearch` corrente de `SearchExperience` (identidade muda com os deps do useCallback).
  // O pill chama `submit()`; aqui só repassamos pro handler registrado (no-op enquanto não há um).
  const submitRef = useRef<() => void>(noop)
  const submit = useCallback(() => submitRef.current(), [])
  const registerSubmit = useCallback((fn: () => void) => {
    submitRef.current = fn
  }, [])
  // `setQ`/`setWide` do useState já são estáveis; `submit`/`registerSubmit` são useCallback estáveis ⇒
  // o value só muda quando `q`/`wide` mudam (evita re-render desnecessário dos consumidores).
  const value = useMemo<HomeSearchValue>(
    () => ({ q, setQ, submit, registerSubmit, wide, setWide }),
    [q, submit, registerSubmit, wide],
  )
  return <HomeSearchContext.Provider value={value}>{children}</HomeSearchContext.Provider>
}

export function useHomeSearch(): HomeSearchValue {
  return useContext(HomeSearchContext)
}
