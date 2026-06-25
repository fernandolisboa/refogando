'use client'
/**
 * Feed SEGUINDO (#277, ADR-0024) — o client que busca e renderiza as Receitas PÚBLICAS dos
 * Cozinheiros que o viewer SEGUE. Funde a disciplina de DOIS precedentes:
 *  - `MyRecipesList` (#61): guard de sessão (Visitante não tem feed) + fetch COM cookie (nativo) +
 *    reset/refetch por locale (AbortController no unmount + na troca de idioma).
 *  - `DiscoveryFeed` (#236): paginação por cursor keyset (IntersectionObserver + botão "Carregar
 *    mais"), append da próxima página; reusa `RecipeResultItem` (nunca duplica o item/lista).
 *
 * Diferença CRÍTICA vs `DiscoveryFeed`: NÃO usa `credentials:'omit'` — o feed é PER-VIEWER (precisa
 * do cookie de sessão); a rota `/api/feed/following` é só-logada (401 anon) e responde `no-store`. A
 * personalização aqui é LEGÍTIMA: é uma superfície SEPARADA, só-logada e NÃO-indexável (Modelo B —
 * nunca personaliza a home anon).
 *
 * UM caminho de reset ATÔMICO em `[locale, authed]`: aborta o in-flight (abortRef compartilhado por
 * página-1 e loadMore), zera `items`/`cursorRef`/`endReached`, refaz a página 1 e semeia o cursor do
 * `nextCursor` dela. Sem isso, ao trocar de idioma o cursor do locale ANTIGO sobreviveria e o
 * IntersectionObserver appendaria a página 2 do idioma errado sobre a lista recém-zerada. O guard
 * `if (loadingMore || cursorRef.current === null) return` impede o loadMore de disparar antes da
 * página 1 semear o cursor.
 *
 * Sem `<h1>`/`<main>` (vivem na page shell `/following`). O empty state é cause-NEUTRO (não-segue-
 * ninguém OU seguidos-sem-pública) e fica FORA da live region (a CTA não é status efêmero).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import type { SearchResult } from '@/domain/recipe-search-read'
import type { FeedResponse } from '@/domain/recipe-feed-read'
import { RecipeResultItem, type BadgeLabels } from './recipe-result-item'

type Status = 'loading' | 'idle' | 'error'

export function FollowingFeed() {
  const { locale, messages } = useLocale()
  const m = messages.seguindoFeed
  const mf = messages.feed
  const mb = messages.busca
  const session = useSession()
  // Visitante só busca depois que a sessão resolveu E está logado (sem disparar um 401 inútil).
  const authed = !session.isPending && !session.error && !!session.data

  const [items, setItems] = useState<SearchResult[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState(false)
  const [endReached, setEndReached] = useState(false)

  // Cursor da próxima página numa ref (lida pelo observer/loadMore SEM stale-closure). `null` ⇒ fim
  // OU página 1 ainda não carregada (o guard do loadMore trata os dois iguais: não pagina).
  const cursorRef = useRef<string | null>(null)
  // UM abortRef compartilhado: página-1 e loadMore. Trocar locale/desmontar aborta o que estiver
  // em voo (incl. um loadMore stale do idioma antigo).
  const abortRef = useRef<AbortController | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const badgeLabels: BadgeLabels = { catalogo: mb.seloCatalogo, comunidade: mb.seloComunidade }

  // Reset ATÔMICO + fetch da PÁGINA 1, keyed em [locale, authed]. Espelha MyRecipesList: setState
  // deferido (não-síncrono no corpo do effect) e limpeza da lista do locale anterior ANTES do refetch.
  useEffect(() => {
    if (!authed) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const url = new URL('/api/feed/following', window.location.origin)
    url.searchParams.set('locale', locale)

    const t = setTimeout(() => {
      // Reset atômico: zera tudo do locale anterior ANTES da nova página 1 (a lista vive fora da
      // live region; o cursor stale não pode sobreviver — senão o observer appenda o idioma errado).
      setItems([])
      setStatus('loading')
      setLoadMoreError(false)
      setLoadingMore(false)
      setEndReached(false)
      cursorRef.current = null
      void (async () => {
        try {
          const res = await fetch(url, { signal: controller.signal }) // COM cookie (per-viewer)
          if (!res.ok) {
            setStatus('error')
            return
          }
          const body: FeedResponse = await res.json()
          setItems(body.feed)
          cursorRef.current = body.nextCursor
          setEndReached(body.nextCursor === null)
          setStatus('idle')
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setStatus('error')
        }
      })()
    }, 0)

    return () => {
      clearTimeout(t)
      controller.abort()
    }
  }, [locale, authed])

  // Próxima página (append). Guard: nada se já carregando OU sem cursor (fim, ou página 1 ainda não
  // semeou). Aborta o in-flight anterior (compartilha o abortRef com a página 1).
  const loadMore = useCallback(() => {
    const cursor = cursorRef.current
    if (loadingMore || cursor === null) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const url = new URL('/api/feed/following', window.location.origin)
    url.searchParams.set('locale', locale)
    url.searchParams.set('cursor', cursor)

    setLoadingMore(true)
    setLoadMoreError(false)
    void (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal }) // COM cookie (per-viewer)
        if (!res.ok) {
          setLoadMoreError(true)
          setLoadingMore(false)
          return
        }
        const body: FeedResponse = await res.json()
        setItems((prev) => [...prev, ...body.feed])
        cursorRef.current = body.nextCursor
        setEndReached(body.nextCursor === null)
        setLoadingMore(false)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setLoadMoreError(true)
        setLoadingMore(false)
      }
    })()
  }, [loadingMore, locale])

  // Scroll infinito via IntersectionObserver. Guarda para jsdom (sem IO ⇒ só o botão).
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const el = sentinelRef.current
    if (el === null) return
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore()
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore])

  // ── Guard de sessão (Visitante não tem feed Seguindo) ───────────────────────
  if (session.isPending) {
    return (
      <div aria-busy="true" className="text-muted">
        {messages.system.loading}
      </div>
    )
  }
  if (!authed) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-muted">{m.precisaEntrar}</p>
        <Button asChild>
          <Link href="/sign-in">{messages.nav.signIn}</Link>
        </Button>
      </div>
    )
  }

  const hasMore = !endReached
  const isEmpty = status === 'idle' && items.length === 0

  return (
    <div className="flex flex-col gap-8">
      {items.length > 0 && (
        <ul className="flex flex-col">
          {items.map((it) => (
            <RecipeResultItem
              key={it.recipeId}
              recipeId={it.recipeId}
              locale={locale}
              slug={it.slug}
              displayedTitle={it.displayedTitle}
              origin={it.origin}
              autoTranslationSignal={it.autoTranslationSignal}
              badgeLabels={badgeLabels}
              autoTranslationLabel={mb.traducaoAutomatica}
              isOwn={it.isOwn}
              ownLabel={mb.seloMinha}
              author={it.author}
              byLabel={mb.porAutor}
              imageUrl={it.imageUrl}
              imageAiGenerated={it.imageAiGenerated}
              aiLabel={mb.imagemSeloIa}
            />
          ))}
        </ul>
      )}

      {/* Empty state cause-NEUTRO (ponte pra descoberta, AC4) — FORA da live region (a CTA não é
          status efêmero). vazioTitulo é <h2> sob o <h1> da page (estrutura de documento p/ leitor). */}
      {isEmpty && (
        <div className="flex flex-col items-start gap-3">
          <h2 className="font-display text-xl font-semibold text-fg">{m.vazioTitulo}</h2>
          <p className="text-muted">{m.vazioCorpo}</p>
          <Button asChild>
            <Link href="/">{m.vazioCta}</Link>
          </Button>
        </div>
      )}

      {/* Paginação (fora da live region). O botão fica montado enquanto há mais; o sentinel
          auto-carrega ao scrollar. */}
      {hasMore && items.length > 0 && (
        <div className="flex flex-col items-center gap-2">
          <div ref={sentinelRef} aria-hidden="true" />
          <Button
            type="button"
            variant="secondary"
            onClick={loadMore}
            disabled={loadingMore}
            aria-busy={loadingMore}
          >
            {mf.carregarMais}
          </Button>
        </div>
      )}

      {/* Live region: só mensagens efêmeras CURTAS (loading/erro/fim). */}
      <div aria-live="polite" className="flex flex-col items-center gap-2 text-sm text-muted">
        {status === 'loading' && <p>{messages.system.loading}</p>}
        {(status === 'error' || loadMoreError) && (
          <p role="alert" className="font-medium text-fg">
            {messages.system.error}
          </p>
        )}
        {loadingMore && <p>{messages.system.loading}</p>}
        {endReached && items.length > 0 && <p>{mf.fim}</p>}
      </div>
    </div>
  )
}
