'use client'

/**
 * Avatar (shadcn/ui — ADR-0018): estrutura + a11y do Radix, pele 100% Refogando.
 * Primitiva composável (Root / Image / Fallback) que espelha a forma do avatar de domínio
 * (`profile/avatar.tsx`): círculo com aro `border-border`, `object-cover`, e — quando não há
 * imagem — INICIAIS de fallback sobre `bg-surface` em serifa (`font-display`), nunca `bg-muted`.
 * O Radix troca para o Fallback quando a `<img>` falha/demora (use `delayMs` no call-site com
 * imagem provável pra evitar flash de iniciais). Três tamanhos (`sm`/`default`/`lg`) cobrem os
 * usos do domínio (aro pequeno no header/perfil público, grande no uploader). Sem `dark:`
 * (os tokens viram no globals.css) e sem focus ring custom.
 */
import { Avatar as AvatarPrimitive } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const avatarVariants = cva(
  'relative flex shrink-0 overflow-hidden rounded-full border border-border',
  {
    variants: { size: { sm: 'size-8', default: 'size-9', lg: 'size-20' } },
    defaultVariants: { size: 'default' },
  },
)

const avatarFallbackVariants = cva(
  'flex size-full items-center justify-center rounded-full bg-surface text-muted-foreground font-display select-none',
  {
    variants: { size: { sm: 'text-xs', default: 'text-sm', lg: 'text-2xl' } },
    defaultVariants: { size: 'default' },
  },
)

function Avatar({
  className,
  size,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & VariantProps<typeof avatarVariants>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(avatarVariants({ size }), className)}
      {...props}
    />
  )
}

function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('aspect-square size-full object-cover', className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  size,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback> & VariantProps<typeof avatarFallbackVariants>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(avatarFallbackVariants({ size }), className)}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback, avatarVariants }
