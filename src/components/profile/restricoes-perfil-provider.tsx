'use client'
/**
 * Contexto das Restrições alimentares SALVAS no perfil (ADR-0041) — o default pré-marcado na criação, na
 * Sugestão de cardápio e na Busca.
 *
 * Montado UMA vez no layout. Carga PREGUIÇOSA: nada é buscado até uma superfície pedir (`useRestricoesPerfil`)
 * — a home de quem só navega não paga o GET. A lista é buscada em `/api/me/restricoes` (owner-only) por conta
 * logada e guardada aqui; trocar de conta descarta a anterior; sair da conta zera. NÃO vem da sessão do Better
 * Auth de propósito (dado sensível fora do payload de sessão).
 *
 * DEFAULT GRACIOSO: sem provider montado (testes que montam só o `LocaleProvider`), `useRestricoesPerfil()`
 * devolve `null` = "sem default" — a superfície se comporta exatamente como antes. Falha do GET também vira
 * "sem default" (nunca pré-marca o que não sabe).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSession } from '@/lib/auth-client'
import { normalizarRestricoes } from '@/domain/restricoes-perfil'
import type { Restricao } from '@/domain/vocabulary'

type Ctx = {
  /** `null` = Visitante, ainda carregando, sem provider ou falha (sem default). */
  restricoes: Restricao[] | null
  pedir: () => void
  /** O formulário do perfil grava e publica aqui — as superfícies abertas veem o novo default sem recarregar. */
  atualizar: (restricoes: Restricao[]) => void
}

const RestricoesPerfilContext = createContext<Ctx>({
  restricoes: null,
  pedir: () => {},
  atualizar: () => {},
})

export function RestricoesPerfilProvider({ children }: { children: ReactNode }) {
  const session = useSession()
  const userId = !session.isPending && !session.error ? (session.data?.user.id ?? null) : null
  const [carregado, setCarregado] = useState<{ userId: string; restricoes: Restricao[] } | null>(null)
  // Conta para a qual o GET já foi disparado (evita repetir a cada consumidor montado).
  const pedidoRef = useRef<string | null>(null)

  const pedir = useCallback(() => {
    if (userId == null || pedidoRef.current === userId) return
    pedidoRef.current = userId
    void (async () => {
      try {
        const res = await fetch('/api/me/restricoes')
        const body = res.ok ? ((await res.json()) as { restricoes?: unknown }) : null
        setCarregado({ userId, restricoes: normalizarRestricoes(body?.restricoes) })
      } catch {
        // Rede caída: sem default agora; o próximo consumidor a montar tenta de novo.
        pedidoRef.current = null
      }
    })()
  }, [userId])

  const atualizar = useCallback(
    (restricoes: Restricao[]) => {
      if (userId == null) return
      pedidoRef.current = userId
      setCarregado({ userId, restricoes })
    },
    [userId],
  )

  const restricoes = userId != null && carregado?.userId === userId ? carregado.restricoes : null
  const value = useMemo(() => ({ restricoes, pedir, atualizar }), [restricoes, pedir, atualizar])
  return <RestricoesPerfilContext.Provider value={value}>{children}</RestricoesPerfilContext.Provider>
}

/** As Restrições salvas do logado (dispara a carga na 1ª vez). `null` = sem default. */
export function useRestricoesPerfil(): Restricao[] | null {
  const { restricoes, pedir } = useContext(RestricoesPerfilContext)
  useEffect(() => {
    pedir()
  }, [pedir])
  return restricoes
}

/** Publica uma lista recém-salva (o formulário do perfil). */
export function useAtualizarRestricoesPerfil(): (restricoes: Restricao[]) => void {
  return useContext(RestricoesPerfilContext).atualizar
}
