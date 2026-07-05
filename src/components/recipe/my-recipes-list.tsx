'use client'
/**
 * Lista de "Minhas criações" (#61) — o cliente que busca e renderiza as Receitas do dono.
 * Espelha a disciplina do feed da Descoberta `DiscoveryFeed` (AbortController no unmount + reset
 * por locale, estados loading/idle/error numa live region, lista FORA da live region) mas é
 * OWNER-SCOPED: consome `GET /api/me/recipes` (que já é fail-closed no servidor) e mostra
 * TUDO o que é do dono — private, playful, removida-do-pool — com selos NEUTROS.
 *
 * ADR-0010: consome o ROUTE HANDLER via `fetch`, não Server Action; NÃO reimplementa domínio
 * (o título exibido + os campos chegam prontos da rota). Cada card é um <Link> pro detalhe
 * canônico `/{locale}/recipes/<slug>` (#231/ADR-0020; fallback por UUID quando sem slug no locale),
 * onde moram as afordâncias de gestão (#59 + #61).
 *
 * Âmbar é EXCLUSIVO do Aviso de restrição (ADR-0004): os selos de estado aqui são NEUTROS
 * (border-border/bg-surface/text-muted) — privada/pública/zoeira/derivada não são alertas.
 *
 * `<h1>` único: o título da página vive na PAGE shell (`/me/recipes`); aqui não há `<h1>`.
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { Image as ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RecipeListItem } from '@/domain/recipe-list-read'
import { recipeDetailPath } from '@/domain/recipe-detail-route'

type Status = 'loading' | 'idle' | 'error'

export function MyRecipesList() {
  const { locale, messages } = useLocale()
  const m = messages.minhasCriacoes
  const session = useSession()
  const pathname = usePathname()
  const returnTo = pathname ?? '/me/recipes'
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

  /** Selos de estado de UM card, na ordem proveniência → visibilidade → linhagem (NEUTROS). */
  function selos(item: RecipeListItem): string[] {
    const out: string[] = []
    // #169/ADR-0019: marcador de proveniência da IMPORTADA da web (origin=web_imported) — PRIMEIRO,
    // como sinal de origem (a importada é privada e creditada à fonte, não criada pelo usuário).
    if (item.origin === 'web_imported') out.push(m.seloImportada)
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
          <Link href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>{messages.nav.signIn}</Link>
        </Button>
      </div>
    )
  }

  const isEmpty = status === 'idle' && items.length === 0

  return (
    <div className="flex flex-col gap-6">
      {/* Grade de CARDS (protótipo RefoStage "Minhas criações") — FORA da live region.
          Cada card: área de imagem (placeholder até a foto chegar via DTO), selos de estado
          (Pública/Privada/Derivada/Regenerada…) e título. Fecha com o card tracejado "começar
          outra". 1 coluna no mobile, 2 no desktop. */}
      {items.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {items.map((item) => {
            const badges = selos(item)
            return (
              <li key={item.id}>
                <Link
                  // #231 (ADR-0020): canônico `/{locale}/recipes/<slug>` no locale corrente; sem slug
                  // naquele locale cai no fallback `/{locale}/recipes/<uuid>` (que 308a). Nunca link nu.
                  href={recipeDetailPath(locale, item.slug ?? item.id)}
                  className="flex h-full flex-col rounded-xl border border-border bg-surface p-4 shadow-sm motion-safe:transition-shadow motion-safe:duration-150 motion-safe:ease-out hover:shadow-md"
                >
                  {item.imageUrl != null ? (
                    // Thumbnail com selo de IA sobreposto (#216) — espelha RecipeResultItem.
                    <div className="relative mb-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        referrerPolicy="no-referrer"
                        className="aspect-video w-full rounded-lg border border-border object-cover"
                      />
                      {item.imageAiGenerated && (
                        <span className="absolute left-1.5 top-1.5 rounded-full border border-border bg-bg/90 px-1.5 py-0.5 text-[0.6rem] font-medium text-muted">
                          {messages.busca.imagemSeloIa}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="mb-3 flex aspect-video items-center justify-center rounded-lg border border-border bg-brand/[0.07] text-brand/40">
                      <ImageIcon className="size-6" strokeWidth={1.5} aria-hidden />
                    </div>
                  )}
                  {badges.length > 0 && (
                    <div className="mb-2.5 flex flex-wrap gap-1.5">
                      {badges.map((s) => (
                        <span
                          key={s}
                          className="inline-flex items-center rounded-full border border-border bg-bg px-2.5 py-0.5 text-xs font-semibold text-fg"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                  <span className="font-display text-lg font-semibold leading-snug text-fg">
                    {item.name}
                  </span>
                </Link>
              </li>
            )
          })}
          {/* Card tracejado "começar outra" (protótipo) — atalho pro /create. */}
          <li>
            <Link
              href="/create"
              className="flex h-full flex-col items-start justify-center gap-2.5 rounded-xl border border-dashed border-border p-4"
            >
              <span className="text-sm text-muted">{m.comecarOutra}</span>
              <span className="inline-flex items-center rounded-full border border-brand px-3.5 py-1.5 text-sm font-semibold text-brand-ink">
                {m.criarReceita}
              </span>
            </Link>
          </li>
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
