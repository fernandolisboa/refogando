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
import { useSyncExternalStore } from 'react'
import { createAuthClient } from 'better-auth/react'
import { adminClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  plugins: [adminClient()],
  // Refetch de foco DESLIGADO (ADR-0028): por padrão o Better Auth refaz o get-session em todo
  // `visibilitychange`→visible — e em dobro (o GET do refresh manager + o do toggle do sessionSignal).
  // O AuthSlot é dono do refetch de volta à aba (foco + visível coalescidos, `useOnTabReturn`), então
  // o da lib só duplicava requests. O refetch ao voltar `online` e o BroadcastChannel seguem ligados.
  sessionOptions: { refetchOnWindowFocus: false },
})

// Esqueci minha senha (#469): `requestPasswordReset` (POST /request-password-reset) e `resetPassword`
// (POST /reset-password). Confirmação de email (#470): `sendVerificationEmail` (POST /send-verification-email,
// o reenvio do link). O cliente é um PROXY de caminho: desestruturar é o jeito certo — `.bind` ou
// qualquer outra propriedade vira segmento de URL e dispara um fetch.
export const {
  signIn,
  signUp,
  signOut,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
} = authClient

const useSessionStore = authClient.useSession

function subscribeNever() {
  return () => {}
}

/**
 * `useSession` do Better Auth com uma correção de hidratação. O da lib lê o atom de sessão com
 * `useSyncExternalStore(subscribe, get, get)`: o snapshot de servidor é o valor ATUAL do atom no
 * navegador. No servidor o atom está sempre pendente (`isPending: true`, `data: null`), mas quando o
 * get-session já respondeu antes de uma parte da árvore hidratar (um Suspense hidrata depois da raiz),
 * o client renderiza logado/anônimo onde o servidor renderizou "carregando": erro de hidratação (#418) e
 * o React refaz a árvore no client. Aqui, enquanto hidrata, o hook devolve o estado do servidor
 * (pendente) e, logo depois, o valor real; fora da hidratação (componente montado depois, navegação
 * client-side) devolve o valor real direto, sem render extra.
 */
export function useSession(): ReturnType<typeof useSessionStore> {
  const session = useSessionStore()
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )
  if (hydrated) return session
  return { ...session, data: null, error: null, isPending: true, isRefetching: false }
}
