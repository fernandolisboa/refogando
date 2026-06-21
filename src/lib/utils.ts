import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * `cn` — merge de classes Tailwind (shadcn/ui, ADR-0018). `clsx` resolve os
 * condicionais/arrays; `twMerge` desempata utilities conflitantes (a última vence),
 * pra `className` de override em call-site não brigar com o default da primitiva.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
