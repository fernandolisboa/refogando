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
 * devolve `null` = "sem default" — a superfície se comporta exatamente como antes. Falha do GET (HTTP não-ok
 * OU rede caída) também vira "sem default" (nunca pré-marca o que não sabe) e NÃO é guardada: o próximo
 * consumidor a montar tenta de novo.
 *
 * A Busca NÃO usa este contexto (ADR-0041 dec.3): pede o default ao servidor (`?restricaoPerfil=1`) e recebe
 * as aplicadas na resposta — a home nunca dispara o GET.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSession } from '@/lib/auth-client'
import {
  SELECAO_INICIAL,
  alternarRestricao,
  normalizarRestricoes,
  restricaoEhCriterio,
  restricoesDoPedido,
  restricoesEfetivas,
  vemDoPerfil,
  type SelecaoRestricoes,
} from '@/domain/restricoes-perfil'
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
        if (!res.ok) throw new Error('restricoes_indisponiveis')
        const body = (await res.json()) as { restricoes?: unknown }
        setCarregado({ userId, restricoes: normalizarRestricoes(body.restricoes) })
      } catch {
        // HTTP não-ok ou rede caída: sem default agora; o próximo consumidor a montar tenta de novo.
        if (pedidoRef.current === userId) pedidoRef.current = null
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

/**
 * A "seleção com default" de UM pedido (ADR-0041 dec.3), ligada ao perfil — a mesma fiação para o wizard, o
 * Formulário estruturado/Prompt aberto, a Conversa e a Sugestão de cardápio:
 * - `restricoes`: as que valem agora (as escolhidas, ou sem toque as do perfil);
 * - `doPedido`: as que valem, restritas às do perfil (Prompt aberto e Conversa só oferecem as salvas);
 * - `vemDoPerfil`: acende a indicação "marcadas a partir do seu perfil";
 * - `escolhaExplicita`: a pessoa tocou e deixou alguma (só isso conta como substância do briefing);
 * - `congelar()`: fixa o perfil visto AGORA (o wizard, ao sair do passo das restrições — uma lista que chegue
 *   depois não entra num pedido sem a pessoa ter visto); `resetar()` volta ao default vivo.
 */
export type SelecaoRestricoesPedido = {
  perfil: Restricao[] | null
  restricoes: Restricao[]
  doPedido: Restricao[]
  vemDoPerfil: boolean
  escolhaExplicita: boolean
  alternar: (r: Restricao) => void
  resetar: () => void
  congelar: () => void
}

export function useSelecaoRestricoes(): SelecaoRestricoesPedido {
  const perfilVivo = useRestricoesPerfil()
  const [sel, setSel] = useState<SelecaoRestricoes>(SELECAO_INICIAL)
  // `{ perfil }` quando congelado (o valor pode ser `null`: congelou antes de a lista chegar ⇒ nenhuma).
  const [congelado, setCongelado] = useState<{ perfil: Restricao[] | null } | null>(null)
  const perfil = congelado ? congelado.perfil : perfilVivo

  const alternar = useCallback(
    (r: Restricao) => setSel((prev) => alternarRestricao(prev, perfil, r)),
    [perfil],
  )
  const resetar = useCallback(() => {
    setSel(SELECAO_INICIAL)
    setCongelado(null)
  }, [])
  const congelar = useCallback(() => setCongelado((c) => c ?? { perfil: perfilVivo }), [perfilVivo])

  return useMemo(
    () => ({
      perfil,
      restricoes: restricoesEfetivas(sel, perfil),
      doPedido: restricoesDoPedido(sel, perfil),
      vemDoPerfil: vemDoPerfil(sel, perfil),
      escolhaExplicita: restricaoEhCriterio(sel),
      alternar,
      resetar,
      congelar,
    }),
    [sel, perfil, alternar, resetar, congelar],
  )
}
