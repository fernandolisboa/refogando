'use client'
/**
 * Saída da sessão sem tela velha (ADR-0028, Adendo 2026-10-23). Componente sem DOM montado uma vez na
 * raiz, ao lado do `AppUpdateGuard`. Observa o atom de sessão do Better Auth (o mesmo do `AuthSlot`) e:
 *
 * - **a conta some** (logada → anônima: "Sair" nesta aba, "Sair" em outra aba via BroadcastChannel, sessão
 *   expirada ou revogada percebida num refetch) ou **troca** (conta A → conta B): recarrega a página. A
 *   recarga refaz a rota no servidor, então o gate do Console (`admin/layout.tsx`) manda para o login e
 *   as telas pessoais renderizam como visitante; e limpa o que só existia em memória (a lista de Usuários
 *   já buscada, gavetas abertas, o cache do roteador do Next, inclusive o do voltar/avançar). Mesma
 *   escolha da saída da exclusão de conta (`delete-account-dialog.tsx`): recarga de verdade, não `router`.
 * - **o papel muda** com a mesma conta (refetch na volta à aba ou ao navegar): `router.refresh()`. O
 *   servidor reavalia os gates com o papel vivo (cookieCache desligado) sem perder o estado do cliente;
 *   um admin rebaixado sai do Console na hora.
 *
 * Só age sobre um valor RESOLVIDO: `isPending` (hidratação, primeira busca) e um `error` de rede não
 * contam como "anônimo", senão uma falha de rede derrubaria a tela de quem está logado (o atom mantém o
 * `data` anterior nesse caso). O 401 é a exceção: o Better Auth zera o `data` e isso é perda de sessão.
 * Entrar (anônimo → logado) não recarrega: quem entra já navega pela tela de login.
 *
 * Fluxo que derruba a sessão e navega por conta própria (a exclusão de conta apaga as sessões no servidor e
 * vai para a home do idioma) segura a recarga com `holdSessionLossReload()` desde ANTES do pedido (um
 * refetch no meio dele já veria a sessão sumir) e solta só se desistir de sair.
 */
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth-client'

let holds = 0

/**
 * Enquanto houver um `hold`, a perda de sessão NÃO recarrega (o chamador navega). Devolve o `release`
 * (idempotente). Uma perda vista durante o hold fica registrada: soltar depois não recarrega por ela.
 */
export function holdSessionLossReload(): () => void {
  holds += 1
  let released = false
  return () => {
    if (released) return
    released = true
    holds -= 1
  }
}

/** Só para testes: o módulo vive entre testes no jsdom. */
export function resetSessionLossGuardForTests(): void {
  holds = 0
}

type Identity = { userId: string; role: string | null }

export function SessionLossGuard() {
  const router = useRouter()
  const { data, isPending, error } = useSession()
  const lastRef = useRef<Identity | null>(null)

  const userId = data?.user.id ?? null
  // Papel por leitura de runtime não tipada (mesmo padrão do `AuthSlot`).
  const rawRole = (data?.user as { role?: unknown } | undefined)?.role
  const role = typeof rawRole === 'string' ? rawRole : null

  // `status` do erro do better-fetch; só o 401 é resposta do servidor dizendo "sem sessão".
  const transientError = error != null && (error as { status?: unknown }).status !== 401

  useEffect(() => {
    if (isPending || transientError) return
    const prev = lastRef.current
    lastRef.current = userId ? { userId, role } : null
    if (!prev) return
    if (userId === prev.userId) {
      if (role !== prev.role) router.refresh()
      return
    }
    if (holds > 0) return
    window.location.reload()
  }, [userId, role, isPending, transientError, router])

  return null
}
