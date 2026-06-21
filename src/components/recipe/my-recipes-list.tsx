'use client'
/**
 * Lista de "Minhas criações" (#61) — o cliente que busca e renderiza as Receitas do dono.
 * Espelha a disciplina do `RecipeFeedExperience` (AbortController no unmount + reset por
 * locale, estados loading/idle/error numa live region, lista FORA da live region) mas é
 * OWNER-SCOPED: consome `GET /api/me/recipes` (que já é fail-closed no servidor) e mostra
 * TUDO o que é do dono — private, playful, removida-do-pool — com selos NEUTROS.
 *
 * ADR-0010: consome o ROUTE HANDLER via `fetch`, não Server Action; NÃO reimplementa domínio
 * (o título exibido + os campos chegam prontos da rota). Cada card é um <Link> pro detalhe
 * canônico `/recipes/:id` (onde moram as afordâncias de gestão, #59 + #61).
 *
 * Âmbar é EXCLUSIVO do Aviso de restrição (ADR-0004): os selos de estado aqui são NEUTROS
 * (border-border/bg-surface/text-muted) — privada/pública/zoeira/derivada não são alertas.
 *
 * `<h1>` único: o título da página vive na PAGE shell (`/me/recipes`); aqui não há `<h1>`.
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import type { RecipeListItem } from '@/domain/recipe-list-read'

type Status = 'loading' | 'idle' | 'error'

/** Selo NEUTRO de estado (espelha o CHIP_BASE do detail-view, sempre rounded-full). */
const SELO =
  'inline-flex items-center rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-muted'

export function MyRecipesList() {
  const { locale, messages } = useLocale()
  const m = messages.minhasCriacoes
  const session = useSession()
  // Visitante só busca depois que a sessão resolveu E está logado (sem disparar um 401 inútil).
  const authed = !session.isPending && !session.error && !!session.data

  const [items, setItems] = useState<RecipeListItem[]>([])
  const [status, setStatus] = useState<Status>('loading')

  // Req em voo: cancelada quando o locale muda ou no unmount (AbortError ignorado).
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!authed) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const url = new URL('/api/me/recipes', window.location.origin)
    url.searchParams.set('locale', locale)

    // Deferido (espelha o feed): o setState não pode rodar síncrono no corpo do effect
    // (cascading renders). TODOS os setState — inclusive o 'loading' inicial — vivem aqui.
    const t = setTimeout(() => {
      // Limpa a lista do locale anterior ANTES do refetch: senão os cards do idioma antigo
      // ficam visíveis durante a re-busca (a lista vive FORA da live region).
      setItems([])
      setStatus('loading')
      void (async () => {
        try {
          const res = await fetch(url, { signal: controller.signal })
          if (!res.ok) {
            setStatus('error')
            return
          }
          const body = (await res.json()) as { recipes: RecipeListItem[] }
          setItems(body.recipes)
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

  /** Selos de estado de UM card, na ordem visibilidade → linhagem (NEUTROS). */
  function selos(item: RecipeListItem): string[] {
    const out: string[] = []
    if (item.resultKind === 'playful') out.push(m.seloPlayful)
    out.push(item.visibility === 'public' ? m.seloPublica : m.seloPrivada)
    // Removida-do-pool pela moderação (#18): o dono enxerga que saiu do acervo (selo NEUTRO).
    if (item.moderationRemovida) out.push(m.seloRemovida)
    if (item.lineageKind === 'edited') out.push(m.seloDerivada)
    if (item.lineageKind === 'regenerated') out.push(m.seloRegenerada)
    return out
  }

  // ── Guard de sessão (Visitante não tem criações) ────────────────────────────
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

  const isEmpty = status === 'idle' && items.length === 0

  return (
    <div className="flex flex-col gap-6">
      {/* Lista — FORA da live region. */}
      {items.length > 0 && (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/recipes/${item.id}`}
                className="flex h-full flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-sm motion-safe:transition-shadow motion-safe:duration-150 motion-safe:ease-out hover:shadow-md"
              >
                <span className="font-display text-lg text-fg">{item.name}</span>
                <span className="flex flex-wrap gap-2">
                  {selos(item).map((s) => (
                    <span key={s} className={SELO}>
                      {s}
                    </span>
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Estado vazio: CTA pra criar a primeira receita (não some no /create gateado). */}
      {isEmpty && (
        <div className="flex flex-col items-start gap-4">
          <p className="text-muted">{m.vazio}</p>
          <Button asChild>
            <Link href="/create">{m.criarPrimeira}</Link>
          </Button>
        </div>
      )}

      {/* Live region: mensagens efêmeras curtas (loading/erro). */}
      <div aria-live="polite" className="flex flex-col gap-2 text-sm text-muted">
        {status === 'loading' && <p>{messages.system.loading}</p>}
        {status === 'error' && (
          <p role="alert" className="font-medium text-fg">
            {m.erro}
          </p>
        )}
      </div>
    </div>
  )
}
