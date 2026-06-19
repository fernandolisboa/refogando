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
 * IntersectionObserver): um botão "Carregar mais" — montado enquanto há próxima página,
 * `disabled`+`aria-busy` durante o carregamento (preserva o foco, não some sob o cursor).
 *
 * A11y: a `<ul>` fica FORA da live region (um append de N itens não deve ser lido inteiro por
 * um leitor de tela). A live region cobre só as mensagens curtas (loading/vazio/fim/erro).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
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

  // #116: estado de sessão SÓ para a CÓPIA (subtítulo). O `viewerId` real e o gate vivem no
  // servidor (GET /api/feed o resolve do cookie) — a UI nunca passa id nenhum. fail-open
  // (error / isPending) → trata como anônimo (subtítulo de comunidade), sem travar a tela.
  const { data: session } = useSession()
  const isAuthed = Boolean(session)
  const subtitulo = isAuthed ? mf.subtituloLogado : mf.subtitulo

  const [items, setItems] = useState<SearchResult[]>([])
  const [endReached, setEndReached] = useState(false)
  const [status, setStatus] = useState<Status>('loading') // estado da 1ª página
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState(false) // falha numa página seguinte

  // Req em voo: cancelada quando o locale muda ou no unmount (AbortError ignorado).
  const abortRef = useRef<AbortController | null>(null)
  // Próximo cursor numa ref: o observer/loadMore o leem SEM stale-closure.
  const cursorRef = useRef<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const badgeLabels: BadgeLabels = { catalogo: m.seloCatalogo, comunidade: m.seloComunidade }
  // #116/own-label: rótulo do selo "Sua receita" — item próprio do viewer (no lugar de
  // "Da comunidade"). Dirigido pelo booleano `isOwn` do DTO (anônimo ⇒ sempre false).
  const ownLabel = m.seloMinha

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
        setLoadMoreError(false)
      }
      try {
        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok) {
          if (reset) setStatus('error')
          else setLoadMoreError(true)
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
        // Req cancelada (locale mudou / unmount) não é erro de verdade.
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (reset) setStatus('error')
        else setLoadMoreError(true)
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

  // Há mais páginas a carregar (1ª página concluída E a API não sinalizou fim). Gateia os
  // controles de paginação por ISTO, não por `items.length>0`: uma página que volta vazia mas
  // com `nextCursor` (ex.: todos sem título exibível) ainda deve poder avançar — senão o feed
  // encalha no estado vazio com mais conteúdo adiante.
  const hasMore = status === 'idle' && !endReached
  // Vazio DE VERDADE: 1ª página concluída, nada exibível E sem próxima página.
  const isEmpty = status === 'idle' && endReached && items.length === 0

  return (
    <Container as="main" className="flex flex-col gap-8 py-8 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {mf.titulo}
        </h1>
        <p className="text-muted">{subtitulo}</p>
      </div>

      {/* Erro da 1ª página: substitui o feed (role=alert anuncia). */}
      {status === 'error' && (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-fg">{messages.system.error}</p>
          <button type="button" className={btnSecondary} onClick={() => void loadPage(null, true)}>
            {messages.system.retry}
          </button>
        </div>
      )}

      {/* Lista — FORA da live region (append não floda o leitor de tela). */}
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
              isOwn={it.isOwn}
              ownLabel={ownLabel}
            />
          ))}
        </ul>
      )}

      {/* Controles de paginação (fora da live region). O botão FICA montado enquanto há mais
          páginas; durante a carga vira `disabled`+`aria-busy` (foco preservado, sem desmontar
          sob o cursor). O sentinel do IntersectionObserver auto-carrega ao scrollar. */}
      {hasMore && (
        <div className="flex flex-col items-center gap-2">
          <div ref={sentinelRef} aria-hidden="true" />
          <button
            type="button"
            className={btnSecondary}
            onClick={loadMore}
            disabled={loadingMore}
            aria-busy={loadingMore}
          >
            {mf.carregarMais}
          </button>
        </div>
      )}

      {/* Live region: só mensagens efêmeras CURTAS (anunciadas educadamente). */}
      <div aria-live="polite" className="flex flex-col items-center gap-2 text-sm text-muted">
        {status === 'loading' && items.length === 0 && <p>{messages.system.loading}</p>}
        {loadingMore && <p>{messages.system.loading}</p>}
        {loadMoreError && <p className="text-fg">{messages.system.error}</p>}
        {isEmpty && <p>{mf.vazio}</p>}
        {status === 'idle' && endReached && items.length > 0 && <p>{mf.fim}</p>}
      </div>
    </Container>
  )
}
