'use client'
/**
 * Feed da Descoberta-home (#236, ADR-0020) — a lista PLANA e cronológica do pool em estado de REPOUSO
 * de `/{locale}`. Sucessor do `RecipeFeedExperience` (#103): a MESMA mecânica de scroll infinito +
 * paginação por cursor keyset (`/api/feed`), mas SEEDADA com a 1ª página que o Server Component já
 * renderizou no HTML (o crawler vê o pool sem JS; o cliente assume daí pra paginar). Reusa
 * `RecipeResultItem` (nunca duplica o item/lista). É um FILHO de `SearchExperience`: vive dentro da
 * superfície da Busca e aparece SÓ no repouso (sem critério). Ao buscar/filtrar, o pai o troca pelos
 * resultados de busca (refino inline).
 *
 * ADR-0010: consome o ROUTE HANDLER `GET /api/feed` via `fetch` (NÃO Server Actions) p/ as páginas
 * SEGUINTES. A 1ª página NÃO é re-buscada — vem como prop `initialItems` (do SSR anônimo/cacheável).
 * Bilíngue: a chrome (`useLocale`) governa os rótulos; o feed seeded já veio no locale do path.
 *
 * Scroll infinito: `IntersectionObserver` num sentinel chama `loadMore`; fallback ACESSÍVEL (e o que o
 * jsdom exercita) é um botão "Carregar mais". A11y: a `<ul>` fica FORA da live region (append não floda
 * o leitor de tela); a live region cobre só mensagens curtas (loading/fim/erro). O título da home vive
 * no PAI (`SearchExperience`), então aqui NÃO há `<h1>`/`<main>` — é um bloco componível.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import type { SearchResult } from '@/domain/recipe-search-read'
import type { FeedResponse } from '@/domain/recipe-feed-read'
import { RecipeResultItem, type BadgeLabels } from './recipe-result-item'

export function DiscoveryFeed({
  initialItems,
  initialNextCursor,
}: {
  /** 1ª página JÁ renderizada no SSR (pool público anônimo). O cliente NÃO a re-busca. */
  initialItems: SearchResult[]
  /** Cursor da 2ª página (null = a 1ª já é o fim). Vem do mesmo `buildFeedResponse` do SSR. */
  initialNextCursor: string | null
}) {
  const { locale, messages } = useLocale()
  const m = messages.busca
  const mf = messages.feed

  const [items, setItems] = useState<SearchResult[]>(initialItems)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState(false)
  const [endReached, setEndReached] = useState(initialNextCursor === null)

  // Próximo cursor numa ref: o observer/loadMore o leem SEM stale-closure. Seedado com o do SSR.
  const cursorRef = useRef<string | null>(initialNextCursor)
  const abortRef = useRef<AbortController | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const badgeLabels: BadgeLabels = { catalogo: m.seloCatalogo, comunidade: m.seloComunidade }
  const ownLabel = m.seloMinha

  // Carrega a PRÓXIMA página (append). A 1ª já veio seeded — só páginas seguintes batem o /api/feed.
  // ANÔNIMO de propósito (`credentials: 'omit'` ⇒ NÃO manda o cookie de sessão): a página 1 é o pool
  // público SSR (viewerId undefined); SEM `omit`, o fetch mandaria o cookie por padrão e o /api/feed
  // (auth-OPCIONAL, sem 401) resolveria o `viewerId` do LOGADO — daí as páginas 2+ passariam a incluir
  // as PRÓPRIAS PRIVADAS do usuário no meio do stream, contradizendo o contrato "anônimo, igual à
  // página 1 indexável" e quebrando a coerência de keyset na fronteira de página. Com `omit`, toda a
  // paginação bate com o SSR anônimo (pool público puro). A personalização do logado vive na superfície
  // PESSOAL ("Minhas criações"), nunca na Descoberta-home.
  const loadMore = useCallback(() => {
    const cursor = cursorRef.current
    if (loadingMore || cursor === null) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const url = new URL('/api/feed', window.location.origin)
    url.searchParams.set('locale', locale)
    url.searchParams.set('cursor', cursor)

    setLoadingMore(true)
    setLoadMoreError(false)
    void (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal, credentials: 'omit' })
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

  useEffect(() => () => abortRef.current?.abort(), [])

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

  const hasMore = !endReached
  const isEmpty = endReached && items.length === 0

  return (
    <div className="flex flex-col gap-8">
      {/* Subtítulo discreto do feed de repouso (a Descoberta). O `<h1>` é do pai. */}
      <p className="text-muted">{mf.subtitulo}</p>

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
              autoTranslationLabel={m.traducaoAutomatica}
              isOwn={it.isOwn}
              ownLabel={ownLabel}
              author={it.author}
              byLabel={m.porAutor}
              imageUrl={it.imageUrl}
              imageAiGenerated={it.imageAiGenerated}
              aiLabel={m.imagemSeloIa}
            />
          ))}
        </ul>
      )}

      {/* Paginação (fora da live region). O botão fica montado enquanto há mais; o sentinel
          auto-carrega ao scrollar. */}
      {hasMore && (
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

      {/* Live region: só mensagens efêmeras CURTAS. */}
      <div aria-live="polite" className="flex flex-col items-center gap-2 text-sm text-muted">
        {loadingMore && <p>{messages.system.loading}</p>}
        {loadMoreError && <p className="text-fg">{messages.system.error}</p>}
        {isEmpty && <p>{mf.vazio}</p>}
        {endReached && items.length > 0 && <p>{mf.fim}</p>}
      </div>
    </div>
  )
}
