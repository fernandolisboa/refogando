'use client'
/**
 * Hook da Caixa de Notificações (#371, ADR-0028 dec 2 — in-app, PULL). Busca `/api/notifications` no
 * mount E uma vez por volta à aba (foco/visível coalescidos — `useOnTabReturn`), sem push/realtime/poll
 * (proporcional ao app). SÓ-LOGADO + Modelo B: `useSession` é client-only/pendente no SSR ⇒ no servidor
 * e p/ Visitante devolve estado vazio e NÃO busca (a chrome anon/cacheável segue byte-idêntica).
 * Falha/401/rede ⇒ assistivo (some, sem badge). Espelha `use-recommended-cooks` (AbortController +
 * token anti-race).
 *
 * `markAllRead()` (ao abrir o painel): POST `/api/notifications/read` SEM body (= marca-tudo no server),
 * zera o badge local otimista e adota o `unreadCount` recontado que o server devolve.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from '@/lib/auth-client'
import { useOnTabReturn } from '@/components/use-tab-return'
import type { NotificationDTO } from '@/server/notification'

type Snapshot = {
  notifications: NotificationDTO[]
  unreadCount: number
  nextCursor: string | null
}

const EMPTY: Snapshot = { notifications: [], unreadCount: 0, nextCursor: null }

export type UseNotifications = Snapshot & { markAllRead: () => void }

export function useNotifications(): UseNotifications {
  const session = useSession()
  const authed = !session.isPending && !session.error && !!session.data

  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY)
  // Token anti-race: só o fetch mais recente pode aplicar seu resultado (mount, volta à aba).
  const reqTokenRef = useRef(0)

  const load = useCallback(async (signal?: AbortSignal) => {
    const token = ++reqTokenRef.current
    try {
      const res = await fetch('/api/notifications', { signal }) // COM cookie de sessão
      if (!res.ok) return // 401/erro: assistivo — mantém o estado atual (badge não engana)
      const body = (await res.json()) as Snapshot
      if (token !== reqTokenRef.current) return // chegou uma resposta mais nova: descarta esta
      setSnapshot({
        notifications: body.notifications ?? [],
        unreadCount: body.unreadCount ?? 0,
        nextCursor: body.nextCursor ?? null,
      })
    } catch {
      // abort (desmontagem) ou rede caída: mantém o estado (não some o que já tinha).
    }
  }, [])

  // Controller do effect corrente: a volta à aba busca com o MESMO signal (abortado na desmontagem /
  // logout, como o fetch de mount).
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    controllerRef.current = controller
    // A limpeza do estado anon vive DENTRO do async IIFE (não no corpo síncrono do effect) — mesmo
    // padrão de `use-recommended-cooks` (evita o cascading-render do lint). Update funcional dá no-op
    // quando já está vazio (sem re-render espúrio no SSR/anon → chrome indexável byte-idêntica).
    void (async () => {
      if (!authed) {
        reqTokenRef.current++ // invalida qualquer fetch em voo (um 200 tardio não repovoa pós-logout)
        setSnapshot((prev) =>
          prev.notifications.length === 0 && prev.unreadCount === 0 ? prev : EMPTY,
        )
        return
      }
      await load(controller.signal)
    })()
    return () => controller.abort()
  }, [authed, load])

  // PULL do ADR-0028: re-busca na volta à aba — `focus` e `visibilitychange` coalescidos em UM load
  // (useOnTabReturn). Visitante (Modelo B): NÃO instala listeners.
  useOnTabReturn(() => void load(controllerRef.current?.signal), authed)

  const markAllRead = useCallback(() => {
    // Otimista: zera o badge já. Se o POST falhar, o próximo pull (foco) reconcilia.
    setSnapshot((prev) => (prev.unreadCount === 0 ? prev : { ...prev, unreadCount: 0 }))
    void (async () => {
      try {
        const res = await fetch('/api/notifications/read', { method: 'POST' }) // sem body = marca-tudo
        if (!res.ok) return
        const body = (await res.json()) as { unreadCount: number }
        setSnapshot((prev) => ({ ...prev, unreadCount: body.unreadCount ?? 0 }))
      } catch {
        // rede caída: o badge fica zerado otimista; o próximo pull corrige.
      }
    })()
  }, [])

  return { ...snapshot, markAllRead }
}
