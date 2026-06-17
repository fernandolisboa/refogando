import type { ComponentPropsWithoutRef, ElementType } from 'react'

/**
 * Contêiner de página (issue #54): centraliza, limita a `--container-page` e aplica o
 * padding horizontal padrão. Fonte ÚNICA do contêiner — as telas #55–#63 compõem por
 * cima via `className` em vez de recopiar `mx-auto max-w-page px-4 sm:px-6`.
 *
 * Polimórfico via `as` pra preservar a semântica: páginas usam `as="main"` (um único
 * landmark <main> por documento), header/footer usam o <div> padrão. Sem hooks: serve
 * em server e client component.
 */
export function Container({
  as,
  className = '',
  ...props
}: { as?: ElementType } & ComponentPropsWithoutRef<'div'>) {
  const Comp = as ?? 'div'
  return <Comp className={`mx-auto w-full max-w-page px-4 sm:px-6 ${className}`.trim()} {...props} />
}
