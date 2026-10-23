'use client'

/**
 * Link para o detalhe de uma Receita, com as duas ajudas de navegação do detalhe (ADR-0053):
 *
 *  - **Pré-carregamento no hover/toque** (`unstable_dynamicOnHover`, ligado por
 *    `experimental.dynamicOnHover` no `next.config.ts`): o `<Link>` comum só pré-carrega o layout de
 *    uma rota dinâmica sem `loading.tsx` (o caso do detalhe, que fica fora do grupo de carregamento para
 *    responder 404/308 de verdade). Com isto, passar o mouse ou encostar o dedo no card busca a página
 *    INTEIRA, e o clique que vem logo depois já abre com ela no cache do roteador.
 *  - **Barra de navegação pendente**: se o clique ainda espera o servidor (sem pré-carregamento, ou ele
 *    não terminou), uma barra fina aparece no topo. O detalhe não tem esqueleto (ver acima), então sem
 *    isto o clique parecia não ter feito nada até a página nova chegar.
 *
 * Use em todo link de LISTA que leva ao detalhe (cards de busca/feed/perfil, Salvos, Minhas receitas,
 * Cardápio, Despensa). Links soltos de texto (ex.: "Ver receita" depois de gerar) podem seguir com `<Link>`.
 */
import type { ComponentProps, ComponentType } from 'react'
import { createPortal } from 'react-dom'
import Link, { useLinkStatus } from 'next/link'

type LinkProps = ComponentProps<typeof Link>

/**
 * `next/link` publica os tipos do Link do Pages Router; a prop `unstable_dynamicOnHover` só existe nos
 * tipos do Link do App Router (`next/dist/client/app-dir/link`), que é o que roda aqui.
 */
const AppLink = Link as ComponentType<LinkProps & { unstable_dynamicOnHover?: boolean }>

export function RecipeLink({ children, ...props }: LinkProps) {
  return (
    <AppLink {...props} unstable_dynamicOnHover>
      {children}
      <NavigationPendingBar />
    </AppLink>
  )
}

/**
 * `useLinkStatus` só funciona DENTRO do `<Link>`; o portal leva a barra para o `<body>`, longe de
 * qualquer `overflow`/`transform` do card que prenderia um `position: fixed`.
 */
function NavigationPendingBar() {
  const { pending } = useLinkStatus()
  if (!pending || typeof document === 'undefined') return null
  return createPortal(<span aria-hidden className="nav-pending-bar" />, document.body)
}
