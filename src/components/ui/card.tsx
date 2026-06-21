import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Card — primitiva shadcn/ui (ADR-0018): estrutura + a11y do shadcn, pele 100% Refogando.
 * Superfície GENÉRICA, só <div>s estilizados (sem Radix → sem "use client"). A pele usa os
 * tokens do alias aditivo (#54): bg-card/text-card-foreground (superfície de massa), border-border,
 * shadow-sm; título em fonte editorial serif (font-display); descrição/secundário em
 * text-muted-foreground (café). Dark herdado via @theme inline (sem `dark:`).
 *
 * ESCOPO (ADR-0015): este é o PRIMITIVO de UI genérico. Componentes de DOMÍNIO NÃO viram
 * "RecipeCard" — eles COMPÕEM <Card> (ex.: recipe-result-item compõe Card sem se renomear).
 */
function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col gap-4 rounded-lg border border-border bg-card text-card-foreground shadow-sm',
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn('flex flex-col gap-1 px-5 pt-5', className)}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        'font-display text-lg font-semibold leading-tight tracking-[-0.01em]',
        className,
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-5', className)} {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center px-5 pb-5', className)}
      {...props}
    />
  )
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
