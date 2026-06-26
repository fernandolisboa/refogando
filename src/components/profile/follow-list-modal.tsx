'use client'

/**
 * Modal da lista COMPLETA de seguidores/seguindo (#307) — a versão "ver todos" dos contadores do perfil
 * (a lite, âncora→preview, é a `ProfileFollowSection`). Reusa o `Sheet` na variante `side="center"` (Radix
 * Dialog #163 ⇒ `role=dialog`, trap de foco, Esc, overlay, clique-fora — de graça), igual ao
 * `recipe-edit-modal`. O nome acessível vem do `SheetTitle`; o `SheetDescription` (aria-describedby, #181)
 * descreve a intenção.
 *
 * Modelo B/ADR-0020: o perfil é anon-cacheável, então NÃO há seed SSR da lista — o modal BUSCA on-demand
 * `GET /api/u/<handle>/<kind>` (público, viewer-independente; `credentials` padrão same-origin basta, sem
 * `omit`). Paginação por CURSOR opaco: "carregar mais" só aparece com `nextCursor` e APPENDA a próxima
 * página (sem dup). Ao (re)abrir ou trocar de aba/perfil o estado RESETA (fase de render, chaveado por
 * `[open,kind,handle]`) e a página 1 é rebuscada — nenhuma lista velha vaza entre aberturas. A busca
 * aborta na desmontagem/troca (AbortController). `open` é CONTROLADO pelo pai (`ProfileFollowSection`).
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/profile/avatar'
import type { FollowUser } from '@/server/user/follow'
import type { Messages } from '@/i18n/messages'

type FollowListPage = { items: FollowUser[]; nextCursor: string | null }

/**
 * Busca PURA de uma página (sem `setState`) — `cur=null` ⇒ página 1. Mantida fora do componente pra os
 * chamadores (efeito de página 1 + handler de "carregar mais") setarem o estado no PRÓPRIO escopo, depois
 * do `await` (padrão lint-clean do `profile-follow-section`). `!res.ok` vira erro lançado (≠ abort).
 */
async function fetchFollowPage(
  handle: string,
  kind: 'followers' | 'following',
  cur: string | null,
  signal: AbortSignal,
): Promise<FollowListPage> {
  const qs = cur ? `?cursor=${encodeURIComponent(cur)}` : ''
  const res = await fetch(`/api/u/${encodeURIComponent(handle)}/${kind}${qs}`, { signal })
  if (!res.ok) throw new Error(`follow-list ${res.status}`)
  return (await res.json()) as FollowListPage
}

export function FollowListModal({
  handle,
  kind,
  open,
  onOpenChange,
  labels,
}: {
  handle: string
  kind: 'followers' | 'following'
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Rótulos já localizados (o perfil é prop-driven por `m`; a ilha não hooka o locale). */
  labels: Messages['perfilPublico']
}) {
  const mp = labels
  const [items, setItems] = useState<FollowUser[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false) // a página 1 resolveu p/ a (abertura,kind,handle) atual
  const [error, setError] = useState(false) // SÓ a página 1 (a inicial). Erro de "carregar mais" é o `moreError`.
  const [loadingMore, setLoadingMore] = useState(false) // busca de "carregar mais" em voo (anti-duplo-clique)
  const [moreError, setMoreError] = useState(false) // falha de "carregar mais" — INLINE, NÃO apaga a lista
  // Guarda do AbortController vivo (página 1 OU "carregar mais"): cancela a busca anterior ao trocar
  // página/kind/handle. Lido na limpeza do efeito (aborta o que estiver em voo, inclusive um load-more).
  const ctrlRef = useRef<AbortController | null>(null)

  const title = kind === 'followers' ? mp.seguidoresTitulo : mp.seguindoTitulo

  // RESET na FASE DE RENDER (≠ efeito): trocar de aba/perfil OU reabrir limpa a lista ANTES de pintar —
  // nenhum item velho vaza, sem `setState` síncrono no efeito (padrão "ajustar estado ao mudar de prop"
  // da doc do React). A assinatura inclui `open` ⇒ reabrir a MESMA aba também rebusca.
  const sig = `${open}|${kind}|${handle}`
  const [prevSig, setPrevSig] = useState(sig)
  if (sig !== prevSig) {
    setPrevSig(sig)
    setItems([])
    setCursor(null)
    setLoaded(false)
    setError(false)
    setLoadingMore(false)
    setMoreError(false)
  }

  // (Re)abertura ou troca de aba/perfil: busca a página 1. `setState` só DEPOIS do `await` (dentro do
  // IIFE), espelhando o efeito do `profile-follow-section` (lint `set-state-in-effect` limpo). A limpeza
  // aborta o controller VIVO (`ctrlRef.current`) — não só o da página 1: um "carregar mais" em voo é
  // cancelado ao trocar de aba/handle, então uma página velha nunca appenda na lista nova (anti-vazamento).
  useEffect(() => {
    if (!open) return
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    void (async () => {
      try {
        const page = await fetchFollowPage(handle, kind, null, ctrl.signal)
        setItems(page.items)
        setCursor(page.nextCursor)
        setError(false)
        setLoaded(true)
      } catch {
        if (ctrl.signal.aborted) return // troca de aba/handle/desmontagem: outra busca assumiu.
        setError(true)
        setLoaded(true)
      }
    })()
    return () => ctrlRef.current?.abort()
  }, [open, kind, handle])

  // "Carregar mais": handler de evento (chamar `setState` aqui é OK), appenda a próxima página. Guarda
  // anti-duplo-clique (`loadingMore`): dois cliques rápidos leriam o MESMO `cursor` do closure e
  // appendariam a mesma página duas vezes (dup visível + key React colidida). Uma falha NÃO mexe no
  // `error` da página 1 (não apaga a lista): vira `moreError` INLINE e o botão segue clicável p/ retry.
  async function onLoadMore() {
    if (cursor === null || loadingMore) return
    setLoadingMore(true)
    setMoreError(false)
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    try {
      const page = await fetchFollowPage(handle, kind, cursor, ctrl.signal)
      // Reset (troca de aba/handle) abortou este controller no meio? Não toca o estado da lista nova.
      if (ctrl.signal.aborted || ctrlRef.current !== ctrl) return
      setItems((prev) => [...prev, ...page.items])
      setCursor(page.nextCursor)
    } catch {
      if (ctrl.signal.aborted) return
      setMoreError(true)
    } finally {
      if (!ctrl.signal.aborted) setLoadingMore(false)
    }
  }

  // A página 1 falhou → bloco de erro grande (a lista está vazia mesmo). Carregando = página 1 em voo.
  const showInitialError = error && items.length === 0
  const showLoading = !loaded && !error
  const isEmpty = loaded && !error && items.length === 0

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="center" closeLabel={mp.listaFechar}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{mp.listaDescricao}</SheetDescription>
        </SheetHeader>

        {showInitialError ? (
          <p role="alert" className="text-sm font-medium text-fg">
            {mp.listaErro}
          </p>
        ) : showLoading ? (
          <p className="text-muted">{mp.listaCarregando}</p>
        ) : isEmpty ? (
          <p className="text-muted">{mp.listaVazia}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {items.map((u) => (
              <li key={u.handle}>
                <Link
                  href={`/u/${u.handle}`}
                  className="flex items-center gap-3 rounded-md py-1 transition-colors hover:text-fg"
                >
                  <Avatar src={u.image} name={u.name} alt="" size="sm" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-fg">{u.name}</span>
                    <span className="truncate text-xs text-muted">@{u.handle}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {/* "Carregar mais" enquanto houver `cursor` (NÃO gateado por erro: um load-more que falhou deve
            poder ser retentado no MESMO cursor). Erro inline ao lado, sem apagar a lista já pintada. */}
        {cursor !== null && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={loadingMore}
              onClick={() => void onLoadMore()}
            >
              {mp.carregarMais}
            </Button>
            {moreError && (
              <span role="alert" className="text-sm font-medium text-fg">
                {mp.listaErroMais}
              </span>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
