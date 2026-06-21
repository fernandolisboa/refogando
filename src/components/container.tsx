import type { ComponentPropsWithoutRef, ElementType } from 'react'

/**
 * Contêiner de página (issue #54): centraliza, limita a `--container-page` e aplica o
 * padding horizontal padrão. Fonte ÚNICA do contêiner — as telas #55–#63 compõem por
 * cima via `className` em vez de recopiar `mx-auto max-w-page px-4 sm:px-6`.
 *
 * Polimórfico via `as` pra preservar a semântica: páginas usam `as="main"` (um único
 * landmark <main> por documento), header/footer usam o <div> padrão. Sem hooks: serve
 * em server e client component.
 *
 * `size` escolhe a largura máxima: `page` (72rem, padrão — busca/feed/grades) ou `reading`
 * (52rem — telas editoriais: detalhe da receita, criar, perfil). Seleciona UMA classe de
 * max-width (NÃO confiar em tailwind-merge: ele não deduplica max-w-page vs max-w-reading,
 * emitiria as duas e a ordem do CSS decidiria — frágil no Tailwind v4).
 */
export function Container({
  as,
  size = 'page',
  className = '',
  ...props
}: { as?: ElementType; size?: 'page' | 'reading' } & ComponentPropsWithoutRef<'div'>) {
  const Comp = as ?? 'div'
  const maxW = size === 'reading' ? 'max-w-reading' : 'max-w-page'
  return <Comp className={`mx-auto w-full ${maxW} px-4 sm:px-6 ${className}`.trim()} {...props} />
}
