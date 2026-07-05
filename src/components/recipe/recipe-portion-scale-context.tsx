'use client'

/**
 * Estado do escalador de porções (#452) ELEVADO a um contexto compartilhado (#453) — o
 * `RecipePortionScaler` (dentro de `RecipeDetailView`) e o `RecipeShareButton` (irmão, montado
 * no topo de `DetailChrome`) precisam do MESMO fator corrente: sem isto, compartilhar por texto
 * enviaria sempre a quantidade ORIGINAL, ignorando a porção ajustada na tela — mina o próprio
 * propósito de "compartilhar pra um grupo maior/menor" (achado de code-review do #453).
 *
 * `PortionScaleProvider` mora em `DetailChrome` (page.tsx), envolvendo TANTO a barra do topo
 * (compartilhar/bookmark) QUANTO `RecipeDetailView` — a árvore de Server Components passada como
 * `children` continua renderizando no servidor normalmente (padrão idiomático do Next: Server
 * Component como filho de Client Component); só o Provider em si é client.
 *
 * SEM porções conhecidas (`view.porcoes == null`): a página passa `originalPorcoes={1}` — o
 * `RecipePortionScaler` nem monta nesse caso (ver `recipe-detail-view.tsx`), então o contexto
 * fica ocioso (`factor` sempre 1, no-op) e o `RecipeShareButton` funciona igual a antes.
 */
import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'

type PortionScaleCtx = {
  porcoes: number
  factor: number
  setPorcoes: Dispatch<SetStateAction<number>>
}

const Ctx = createContext<PortionScaleCtx | null>(null)

export function PortionScaleProvider({
  originalPorcoes,
  children,
}: {
  originalPorcoes: number
  children: ReactNode
}) {
  const [porcoes, setPorcoes] = useState(originalPorcoes)
  const factor = porcoes / originalPorcoes
  return <Ctx.Provider value={{ porcoes, factor, setPorcoes }}>{children}</Ctx.Provider>
}

/**
 * `factor` corrente pro compartilhamento/exibição escalados. Fora de um `PortionScaleProvider`
 * (defensivo — não deveria ocorrer em produção, todo `DetailChrome` monta o provider) devolve o
 * no-op seguro `factor: 1`, nunca lança.
 */
export function usePortionScale(): PortionScaleCtx {
  const ctx = useContext(Ctx)
  if (ctx == null) {
    return { porcoes: 1, factor: 1, setPorcoes: () => {} }
  }
  return ctx
}
