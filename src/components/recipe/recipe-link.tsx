'use client'

/**
 * Link para o detalhe de uma Receita, com as duas ajudas de navegação do detalhe (ADR-0053):
 *
 *  - **Pré-carregamento quando o mouse para no card**: o `<Link>` comum só pré-carrega o layout de uma rota
 *    dinâmica sem `loading.tsx` (o caso do detalhe, que fica fora do grupo de carregamento para responder
 *    404/308 de verdade). Com o mouse parado `HOVER_DWELL_MS` sobre o link, pedimos a página INTEIRA
 *    (`router.prefetch` com `PrefetchKind.FULL`), e o clique que vem logo depois abre do cache do roteador.
 *    De propósito NÃO usamos `unstable_dynamicOnHover`: ele também dispara no `touchstart` (toda rolagem que
 *    começa num card no celular viraria uma renderização completa no servidor), não tem espera e deixa o link
 *    "promovido" para sempre (volta a pré-carregar inteiro ao reaparecer na tela e depois de cada
 *    `router.refresh()`). No toque fica o pré-carregamento padrão do `<Link>`.
 *  - **Barra de navegação pendente**: se o clique ainda espera o servidor (sem pré-carregamento, ou ele não
 *    terminou), uma barra fina aparece no topo. O detalhe não tem esqueleto (ver acima), então sem isto o clique
 *    parecia não ter feito nada até a página nova chegar.
 *
 * Use em todo link de LISTA que leva ao detalhe (cards de busca/feed/perfil, Salvos, Minhas receitas,
 * Cardápio, Despensa). Links soltos de texto (ex.: "Ver receita" depois de gerar) podem seguir com `<Link>`.
 */
import { useEffect, useRef, type ComponentProps } from 'react'
import { createPortal } from 'react-dom'
import Link, { useLinkStatus } from 'next/link'
import { useRouter } from 'next/navigation'
import { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types'

/** Quanto o mouse precisa ficar sobre o link para valer o pré-carregamento (passar por cima a caminho de outro não conta). */
export const HOVER_DWELL_MS = 100

type RecipeLinkProps = Omit<ComponentProps<typeof Link>, 'href'> & { href: string }

export function RecipeLink({ children, href, onMouseEnter, onMouseLeave, ...props }: RecipeLinkProps) {
  const router = useRouter()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function cancel() {
    if (timer.current != null) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => cancel, [])

  return (
    <Link
      {...props}
      href={href}
      onMouseEnter={(e) => {
        onMouseEnter?.(e)
        cancel()
        timer.current = setTimeout(() => {
          timer.current = null
          router.prefetch(href, { kind: PrefetchKind.FULL })
        }, HOVER_DWELL_MS)
      }}
      onMouseLeave={(e) => {
        onMouseLeave?.(e)
        cancel()
      }}
    >
      {children}
      <NavigationPendingBar />
    </Link>
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
