'use client'
/**
 * Descoberta de Cozinheiros (#308) — a experiência cliente de `/cooks`. DOIS modos derivados do termo:
 * **vazio/<3 → recomendações** (popularidade, `/api/cooks`); **≥3 → busca** por nome/@handle
 * (`/api/search/cooks`). Filtro de **Cozinha** (multi, `FacetFieldset`) e **scroll infinito** (keyset)
 * nos dois. Cartões reusam `CookCard`.
 *
 * Modelo B / cache: a PÁGINA (server) semeia a lista GLOBAL (viewer-independente → anon-cacheável). AQUI,
 * no cliente, se LOGADO re-busca a 1ª página personalizada (`/api/cooks` com cookie → exclui você +
 * já-seguidos); ANÔNIMO mantém o seed (sem fetch no estado-seed). Busca é cookie-free (viewer-independente).
 *
 * Anti-corrida: um `token` por (modo/termo/cozinha/login) — respostas de uma assinatura superada são
 * descartadas. `authed` (useSession) escolhe Seguir-inline vs bounce-pro-sign-in (no `CookCard`).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { useCozinhaVocab } from '@/components/i18n/cozinha-vocab-provider'
import { Input } from '@/components/ui/input'
import { FacetFieldset, type FacetOption } from './facet-fieldset'
import { CookCard, type CookCardCook } from './cook-card'
import type { RecommendedCook } from '@/domain/recommended-cooks-read'

/** Espelha `COOK_MIN_TERM_LEN` do servidor: < 3 chars → modo recomendações (não busca). */
const COOK_MIN_SEARCH = 3

type Page = { cooks: CookCardCook[]; nextCursor: string | null }

export function CooksDiscovery({
  initialCooks,
  initialNextCursor,
  locale,
}: {
  initialCooks: RecommendedCook[]
  initialNextCursor: string | null
  locale: string
}) {
  const { messages } = useLocale()
  const m = messages.descobrirCozinheiros
  const cardLabels = messages.cozinheirosSugeridos
  const aiLabel = messages.busca.imagemSeloIa
  const cozinhaOptions: FacetOption[] = useCozinhaVocab().map(({ value, label }) => ({ value, label }))
  const pathname = usePathname()
  const returnTo = pathname ?? '/cooks'

  const session = useSession()
  const authed = !session.isPending && !session.error && !!session.data

  const [q, setQ] = useState('')
  const [dq, setDq] = useState('') // termo debounced
  const [selectedCozinhas, setSelectedCozinhas] = useState<string[]>([])
  const [items, setItems] = useState<CookCardCook[]>(initialCooks)
  const [cursor, setCursor] = useState<string | null>(initialNextCursor)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // debounce do termo (300ms) → dq
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const mode: 'search' | 'recs' = dq.length >= COOK_MIN_SEARCH ? 'search' : 'recs'
  const cozinhaParam = selectedCozinhas.join(',')
  const sig = `${mode}|${dq}|${cozinhaParam}` // assinatura da consulta atual
  const SEED_SIG = 'recs||'

  const tokenRef = useRef(0)
  const firstRun = useRef(true)

  const fetchPage = useCallback(
    async (cur: string | null): Promise<Page> => {
      const cz = cozinhaParam ? `&cozinha=${encodeURIComponent(cozinhaParam)}` : ''
      const cc = cur ? `&cursor=${encodeURIComponent(cur)}` : ''
      const url =
        mode === 'search'
          ? `/api/search/cooks?q=${encodeURIComponent(dq)}${cz}${cc}`
          : `/api/cooks?locale=${encodeURIComponent(locale)}${cz}${cc}`
      // recs → cookie (personalização do logado); busca → cookie-free (viewer-independente, cacheável).
      const res = await fetch(url, { credentials: mode === 'search' ? 'omit' : 'include' })
      if (!res.ok) throw new Error('fetch failed')
      return (await res.json()) as Page
    },
    [mode, dq, cozinhaParam, locale],
  )

  // (re)carrega a 1ª página quando a assinatura OU o login muda. Pula SÓ o estado-seed inicial (recs
  // global anônimo), que o SSR já trouxe — evita um fetch redundante no caso anon mais comum.
  useEffect(() => {
    const isSeedState = sig === SEED_SIG && !authed
    if (firstRun.current) {
      firstRun.current = false
      if (isSeedState) return
    }
    const token = ++tokenRef.current
    setLoading(true)
    fetchPage(null)
      .then((res) => {
        if (token !== tokenRef.current) return
        setItems(res.cooks)
        setCursor(res.nextCursor)
        setLoading(false)
      })
      .catch(() => {
        if (token !== tokenRef.current) return
        setItems([])
        setCursor(null)
        setLoading(false)
      })
    // sig + authed cobrem todas as deps de fetchPage; reexecutar por identidade do callback duplicaria.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, authed])

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore || loading) return
    const token = tokenRef.current
    setLoadingMore(true)
    fetchPage(cursor)
      .then((res) => {
        if (token !== tokenRef.current) return // assinatura superada durante o load-more
        setItems((prev) => [...prev, ...res.cooks])
        setCursor(res.nextCursor)
        setLoadingMore(false)
      })
      .catch(() => {
        if (token !== tokenRef.current) return
        setLoadingMore(false)
      })
  }, [cursor, loadingMore, loading, fetchPage])

  // scroll infinito: observa o sentinela no fim da lista.
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !cursor) return
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore()
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [cursor, loadMore])

  const toggleCozinha = (value: string) =>
    setSelectedCozinhas((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )

  const showEmpty = !loading && items.length === 0

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {m.titulo}
        </h1>
        <p className="text-muted">{m.subtitulo}</p>
      </div>

      <div className="max-w-reading">
        <label htmlFor="cooks-search" className="sr-only">
          {m.buscarLabel}
        </label>
        <Input
          id="cooks-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={m.buscarPlaceholder}
          autoComplete="off"
        />
      </div>

      <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
        {cozinhaOptions.length > 0 && (
          <aside className="sm:w-44 sm:shrink-0">
            <FacetFieldset
              legend={m.cozinhaLabel}
              options={cozinhaOptions}
              selected={selectedCozinhas}
              onToggle={toggleCozinha}
            />
          </aside>
        )}
        <div className="min-w-0 flex-1">
          {showEmpty ? (
            <p className="text-muted">{mode === 'search' ? m.vazioBusca : m.vazioLista}</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {items.map((cook) => (
                <li key={cook.handle}>
                  <CookCard
                    cook={cook}
                    labels={cardLabels}
                    aiLabel={aiLabel}
                    authed={authed}
                    returnTo={returnTo}
                  />
                </li>
              ))}
            </ul>
          )}
          {/* Sentinela do scroll infinito + status efêmero (única região "viva" — resultados ficam fora). */}
          <div ref={sentinelRef} aria-hidden className="h-1" />
          {(loading || loadingMore) && (
            <p role="status" className="mt-4 text-sm text-muted">
              {m.carregando}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
