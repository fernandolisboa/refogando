'use client'
/**
 * Tela "link de confirmação inválido" (#470) — o Better Auth devolveu `?error=` (token expirado/adulterado).
 * O Usuário informa o email e pede um link novo (`ResendVerification`, resposta neutra: sem enumeração).
 * `returnTo` segue adiante como destino pós-confirmação do link novo.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { ResendVerification } from '@/components/auth/resend-verification'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function VerifyEmailRetry({ returnTo }: { returnTo: string }) {
  const { messages } = useLocale()
  const m = messages.auth
  const [email, setEmail] = useState('')

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold text-fg">{m.verificarErroTitulo}</h1>
      <p className="text-sm text-muted">{m.verificarErroDescricao}</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="verify-email">{m.email}</Label>
        <Input
          id="verify-email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <ResendVerification email={email} callbackURL={returnTo} />
      <p className="text-sm text-muted">
        <Link href="/sign-in" className="font-medium text-brand-ink hover:underline">
          {m.voltarEntrar}
        </Link>
      </p>
    </div>
  )
}
