'use client'
/**
 * Feed do /recipes (#103) — lista PLANA e cronológica do pool, scroll infinito, SEM filtros
 * nem campo de busca. Substitui o browse facetado (#98), que era a home menos o input. Provê
 * o ÚNICO `<main>` do documento (via `<Container as="main">`).
 *
 * ADR-0010: consome o ROUTE HANDLER `GET /api/feed` via `fetch` (NÃO Server Actions). Páginas
 * por CURSOR opaco: a 1ª carga não manda cursor; cada resposta traz `nextCursor` (null = fim).
 * Bilíngue (ADR-0014/0001): troca de idioma RESETA o feed e recarrega do começo.
 *
 * Scroll infinito: um `IntersectionObserver` num sentinel ao pé da lista chama `loadMore` ao
 * entrar na viewport. Fallback ACESSÍVEL (e o que os testes jsdom exercitam, onde não há
 * IntersectionObserver): um botão "Carregar mais" sempre presente enquanto há próxima página.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'
import { btnSecondary } from '@/components/button'
import type { SearchResult } from '@/domain/recipe-search-read'
import type { FeedResponse } from '@/domain/recipe-feed-read'
import { RecipeResultItem, type BadgeLabels } from './recipe-result-item'

type Status = 'loading' | 'idle' | 'error'

export function RecipeFeedExperience() {
  const { locale, messages } = useLocale()
  const m = messages.busca
  const mf = messages.feed

  const [items, setItems] = useState<SearchResult[]>([])
  const [endReached, setEndReached] = useState(false)
  const [status, setStatus] = useState<Status>('loading') // estado da 1ª página
  const [loadingMore, setLoadingMore] = useState(false)

  // Req em voo: cancelada quando o locale muda ou no unmount (AbortError ignorado).
  const abortRef = useRef<AbortController | null>(null)
  // Próximo cursor numa ref: o observer/loadMore o leem SEM stale-closure.
  const cursorRef = useRef<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const badgeLabels: BadgeLabels = { catalogo: m.seloCatalogo, comunidade: m.seloComunidade }

  // Carrega uma página. reset=true ⇒ 1ª página (substitui a lista); senão ⇒ append.
  const loadPage = useCallback(
    async (cursor: string | null, reset: boolean) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const url = new URL('/api/feed', window.location.origin)
      url.searchParams.set('locale', locale)
      if (cursor !== null) url.searchParams.set('cursor', cursor)

      if (reset) {
        setStatus('loading')
        setEndReached(false)
      } else {
        setLoadingMore(true)
      }
      try {
        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok) {
          if (reset) setStatus('error')
          setLoadingMore(false)
          return
        }
        const body: FeedResponse = await res.json()
        setItems((prev) => (reset ? body.feed : [...prev, ...body.feed]))
        cursorRef.current = body.nextCursor
        setEndReached(body.nextCursor === null)
        if (reset) setStatus('idle')
        setLoadingMore(false)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (reset) setStatus('error')
        setLoadingMore(false)
      }
    },
    [locale],
  )

  // 1ª página ao montar + RESET quando o locale muda. O load é DEFERIDO por setTimeout
  // (espelha o debounce de SearchExperience): o setState de loadPage não pode rodar
  // síncrono no corpo do effect (cascading renders). Cleanup cancela o timer pendente.
  useEffect(() => {
    cursorRef.current = null
    const t = setTimeout(() => void loadPage(null, true), 0)
    return () => clearTimeout(t)
  }, [loadPage])

  useEffect(() => () => abortRef.current?.abort(), [])

  const loadMore = useCallback(() => {
    if (loadingMore || cursorRef.current === null) return
    void loadPage(cursorRef.current, false)
  }, [loadingMore, loadPage])

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

  const isEmpty = status === 'idle' && items.length === 0

  return (
    <Container as="main" className="flex flex-col gap-8 py-8 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {mf.titulo}
        </h1>
        <p className="text-muted">{mf.subtitulo}</p>
      </div>

      {/* Região do feed. `aria-live` anuncia o fim do loading inicial a um leitor de tela. */}
      <div aria-live="polite" aria-busy={status === 'loading'} className="flex flex-col gap-6">
        {status === 'error' && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-fg">{messages.system.error}</p>
            <button type="button" className={btnSecondary} onClick={() => void loadPage(null, true)}>
              {messages.system.retry}
            </button>
          </div>
        )}

        {status === 'loading' && items.length === 0 && (
          <p className="text-muted">{messages.system.loading}</p>
        )}

        {isEmpty && <p className="text-muted">{mf.vazio}</p>}

        {items.length > 0 && (
          <ul className="flex flex-col gap-4">
            {items.map((it) => (
              <RecipeResultItem
                key={it.recipeId}
                recipeId={it.recipeId}
                displayedTitle={it.displayedTitle}
                origin={it.origin}
                autoTranslationSignal={it.autoTranslationSignal}
                badgeLabels={badgeLabels}
                autoTranslationLabel={m.traducaoAutomatica}
              />
            ))}
          </ul>
        )}

        {/* Mais páginas: sentinel (observer) + botão acessível/fallback OU linha de loading. */}
        {items.length > 0 && !endReached && (
          <div className="flex flex-col items-center gap-3">
            <div ref={sentinelRef} aria-hidden="true" />
            {loadingMore ? (
              <p className="text-muted">{messages.system.loading}</p>
            ) : (
              <button type="button" className={btnSecondary} onClick={loadMore}>
                {mf.carregarMais}
              </button>
            )}
          </div>
        )}

        {/* Fim do feed. */}
        {items.length > 0 && endReached && (
          <p className="text-center text-sm text-muted">{mf.fim}</p>
        )}
      </div>
    </Container>
  )
}
