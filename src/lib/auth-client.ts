'use client'
/**
 * Cliente Better Auth no browser (issue #55, ADR-0010). Fonte ÚNICA do cliente — a UI
 * fala com o route handler `/api/auth/[...all]` via fetch (NÃO Server Actions; sem
 * reimplementar regra de domínio no front). Espelha o `getAuth()` do servidor.
 *
 * `baseURL` omitido de propósito: resolve contra a origem do browser (mesma origem do
 * handler), então NÃO precisa de nenhuma `NEXT_PUBLIC_*` (o repo evita conscientemente —
 * a verdade de "Google ligado?" é server-only `hasGoogle` em auth.ts e chega à UI por
 * prop, nunca por env público).
 *
 * `adminClient()` pareia com o plugin `admin` do servidor só para a inferência do cliente
 * bater com a instância do servidor (mesmos atoms). NÃO usamos papel nesta fatia (#55
 * gateia por PRESENÇA de sessão; papéis são #63 — LANDMINE #51): nada aqui lê role.
 */
import { createAuthClient } from 'better-auth/react'
import { adminClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  plugins: [adminClient()],
})

// Esqueci minha senha (#469): `requestPasswordReset` (POST /request-password-reset) e `resetPassword`
// (POST /reset-password). Confirmação de email (#470): `sendVerificationEmail` (POST /send-verification-email,
// o reenvio do link). O cliente é um PROXY de caminho: desestruturar é o jeito certo — `.bind` ou
// qualquer outra propriedade vira segmento de URL e dispara um fetch.
export const {
  useSession,
  signIn,
  signUp,
  signOut,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
} = authClient
