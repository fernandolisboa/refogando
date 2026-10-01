'use client'
/**
 * Despensa (`/me/pantry`, ADR-0038): o que a pessoa tem em casa (chips, adicionar vários de uma vez,
 * atalhos de itens comuns) e "o que dá pra fazer" — as Receitas que ela pode salvar com no máximo 3 Itens
 * faltando, em duas seções ("Dá pra fazer agora" / "Falta pouco"). Pontes: "Pôr o que falta na lista" (o
 * servidor recalcula o que falta), "Pôr no cardápio" (ADR-0040, o painel do detalhe) e "Criar receita com o
 * que tenho" (`/create?q=`, nunca gera sozinho).
 * Consome `GET/POST/DELETE /api/me/pantry`, `DELETE /api/me/pantry/[itemId]`, `GET /api/me/pantry/matches`
 * e `POST /api/me/pantry/missing-to-list`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarPlus, ChefHat, ShoppingCart, Sparkles, X } from 'lucide-react'
import { useLocale } from '@/i18n/provider'
import {
  MAX_PANTRY_ADD_BATCH,
  MAX_PANTRY_ITEMS,
  PANTRY_NAME_MAX,
  pantryMatchKey,
  splitPantryMatches,
} from '@/domain/pantry'
import { createFromSearchHref } from '@/domain/generate-from-search'
import { recipeDetailPath } from '@/domain/recipe-detail-route'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MealPlanThumb } from '@/components/meal-plan/meal-plan-thumb'
import { PlanRecipePanel } from '@/components/meal-plan/plan-recipe-panel'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'

type PantryItem = { id: string; nome: string }
type PantryMatch = {
  id: string
  name: string
  slug?: string
  imageUrl?: string
  imageAiGenerated?: boolean
  total: number
  covered: number
  missing: string[]
}
type Status = 'loading' | 'idle' | 'error'
type ListOutcome = { recipeId: string; listId: string; listName: string } | { recipeId: string; error: string }

export function PantryView() {
  const { locale, messages } = useLocale()
  const m = messages.despensa
  const session = useSession()
  const authed = !session.isPending && !session.error && !!session.data
  const pathname = usePathname()

  const [items, setItems] = useState<PantryItem[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [matches, setMatches] = useState<PantryMatch[]>([])
  const [matchStatus, setMatchStatus] = useState<Status>('loading')
  const [basics, setBasics] = useState(true)
  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listPending, setListPending] = useState<string | null>(null)
  const [listOutcome, setListOutcome] = useState<ListOutcome | null>(null)
  const matchAbort = useRef<AbortController | null>(null)

  const loadMatches = useCallback(async () => {
    matchAbort.current?.abort()
    const controller = new AbortController()
    matchAbort.current = controller
    setMatchStatus('loading')
    const url = new URL('/api/me/pantry/matches', window.location.origin)
    url.searchParams.set('basics', basics ? '1' : '0')
    url.searchParams.set('locale', locale)
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) {
        setMatchStatus('error')
        return
      }
      const body = (await res.json()) as { matches: PantryMatch[] }
      setMatches(body.matches)
      setMatchStatus('idle')
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setMatchStatus('error')
    }
  }, [basics, locale])

  const loadItems = useCallback(async () => {
    try {
      const res = await fetch('/api/me/pantry')
      if (!res.ok) {
        setStatus('error')
        return
      }
      const body = (await res.json()) as { items: PantryItem[] }
      setItems(body.items)
      setStatus('idle')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    if (!authed) return
    const t = setTimeout(() => {
      void loadItems()
    }, 0)
    return () => clearTimeout(t)
  }, [authed, loadItems])

  // Resultados: recarrega quando a Despensa muda (itens) ou a opção de básicos muda.
  useEffect(() => {
    if (!authed || status !== 'idle') return
    const t = setTimeout(() => {
      void loadMatches()
    }, 0)
    return () => clearTimeout(t)
  }, [authed, status, items, loadMatches])

  useEffect(() => () => matchAbort.current?.abort(), [])

  async function addNames(names: string | string[]) {
    if (adding) return false
    setAdding(true)
    setError(null)
    try {
      const res = await fetch('/api/me/pantry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ names }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(
          body.error === 'despensa_cheia'
            ? m.erroCheia.replace('{max}', String(MAX_PANTRY_ITEMS))
            : body.error === 'dados_invalidos'
              ? m.erroAdicionar
                  .replace('{max}', String(PANTRY_NAME_MAX))
                  .replace('{lote}', String(MAX_PANTRY_ADD_BATCH))
              : m.erro,
        )
        return false
      }
      await loadItems()
      return true
    } catch {
      setError(m.erro)
      return false
    } finally {
      setAdding(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (input.trim() === '') return
    if (await addNames(input)) setInput('')
  }

  async function handleRemove(item: PantryItem) {
    setError(null)
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    // O botão focado some com o chip: devolve o foco ao campo de adicionar (senão cai no <body>).
    document.getElementById('despensa-adicionar')?.focus()
    try {
      const res = await fetch(`/api/me/pantry/${item.id}`, {
        method: 'DELETE',
      })
      if (!res.ok && res.status !== 404) {
        setError(m.erro)
        await loadItems()
        return
      }
      // A remoção otimista já disparou os resultados ANTES do DELETE confirmar; recarrega agora que o item
      // saiu do banco (senão uma Receita coberta só por ele ficaria listada).
      void loadMatches()
    } catch {
      setError(m.erro)
      await loadItems()
    }
  }

  async function handleClear() {
    if (!window.confirm(m.confirmarLimpar)) return
    setError(null)
    try {
      const res = await fetch('/api/me/pantry', { method: 'DELETE' })
      if (!res.ok) setError(m.erro)
    } catch {
      setError(m.erro)
    }
    await loadItems()
  }

  async function handleMissingToList(recipeId: string) {
    if (listPending) return
    setListPending(recipeId)
    setListOutcome(null)
    try {
      const res = await fetch(`/api/me/pantry/missing-to-list?locale=${encodeURIComponent(locale)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipeId, basics }),
      })
      if (!res.ok) {
        // 409 = a Despensa mudou e a Receita já não tem nada faltando: aviso neutro + recarrega os resultados.
        if (res.status === 409) {
          setListOutcome({ recipeId, error: m.nadaFaltando })
          void loadMatches()
          return
        }
        setListOutcome({ recipeId, error: m.erroPorNaLista })
        return
      }
      const body = (await res.json()) as { listId: string; listName: string }
      setListOutcome({
        recipeId,
        listId: body.listId,
        listName: body.listName,
      })
    } catch {
      setListOutcome({ recipeId, error: m.erroPorNaLista })
    } finally {
      setListPending(null)
    }
  }

  if (session.isPending) {
    return (
      <div aria-busy="true" className="text-muted">
        {messages.system.loading}
      </div>
    )
  }
  if (!authed) {
    const returnTo = pathname ?? '/me/pantry'
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-muted">{m.precisaEntrar}</p>
        <Button asChild>
          <Link href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>{messages.nav.signIn}</Link>
        </Button>
      </div>
    )
  }
  if (status === 'loading') {
    return (
      <div aria-busy="true" className="text-muted">
        {messages.system.loading}
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="text-muted">{m.erroCarregar}</p>
        <Button variant="secondary" onClick={() => void loadItems()}>
          {messages.system.retry}
        </Button>
      </div>
    )
  }

  const presentKeys = new Set(items.map((i) => pantryMatchKey(i.nome)))
  const suggestions = m.sugestoes.filter((s) => !presentKeys.has(pantryMatchKey(s)))
  const { ready, almost } = splitPantryMatches(matches)
  const createHref = createFromSearchHref(m.criarPrompt.replace('{lista}', () => items.map((i) => i.nome).join(', ')))

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <label htmlFor="despensa-adicionar" className="text-sm font-medium text-fg">
            {m.adicionarRotulo}
          </label>
          <div className="flex flex-wrap items-start gap-2">
            <Input
              id="despensa-adicionar"
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                setError(null)
              }}
              placeholder={m.adicionarPlaceholder}
              aria-describedby="despensa-adicionar-dica"
              className="w-full sm:w-80"
            />
            <Button type="submit" disabled={adding || input.trim() === ''}>
              {adding ? m.adicionando : m.adicionar}
            </Button>
          </div>
          <p id="despensa-adicionar-dica" className="text-xs text-muted">
            {m.adicionarDica}
          </p>
        </form>

        {suggestions.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted">{m.sugestoesTitulo}</p>
            <ul className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    disabled={adding}
                    aria-label={m.sugestaoAdicionar.replace('{nome}', () => s)}
                    onClick={() => void addNames(s)}
                    className="rounded-full border border-dashed border-border px-3 py-1 text-sm text-muted hover:border-brand hover:text-fg disabled:opacity-50"
                  >
                    + {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error != null && (
          <p role="alert" className="text-sm font-medium text-fg">
            {error}
          </p>
        )}

        {items.length === 0 ? (
          <p className="text-muted">{m.vazia}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted">
                {items.length === 1 ? m.itemContagem : m.itensContagem.replace('{n}', String(items.length))}
              </p>
              <Button variant="ghost" size="sm" onClick={() => void handleClear()}>
                {m.limpar}
              </Button>
            </div>
            <ul className="flex flex-wrap gap-2">
              {items.map((i) => (
                <li
                  key={i.id}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface py-1 pr-1 pl-3 text-sm text-fg shadow-sm"
                >
                  {i.nome}
                  <button
                    type="button"
                    aria-label={m.remover.replace('{nome}', () => i.nome)}
                    onClick={() => void handleRemove(i)}
                    className="inline-flex size-6 items-center justify-center rounded-full text-muted hover:bg-brand/10 hover:text-fg"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {items.length > 0 && (
        <section aria-labelledby="despensa-resultados" className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h2 id="despensa-resultados" className="font-display text-2xl font-semibold tracking-tight text-fg">
              {m.resultadosTitulo}
            </h2>
            <label className="inline-flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={basics}
                onChange={(e) => setBasics(e.target.checked)}
                className="size-4 accent-brand"
              />
              {m.basicos.replace('{lista}', m.basicosLista)}
            </label>
            <p className="text-xs text-muted">{m.comoCasa}</p>
          </div>

          <div aria-live="polite" className="text-sm text-muted">
            {matchStatus === 'loading' && <p>{messages.system.loading}</p>}
            {matchStatus === 'error' && <p className="font-medium text-fg">{m.erroCarregarResultados}</p>}
            {matchStatus === 'idle' && matches.length === 0 && <p>{m.semResultados}</p>}
          </div>

          {ready.length > 0 && (
            <MatchSection
              kind="ready"
              title={m.prontasTitulo}
              matches={ready}
              listPending={listPending}
              listOutcome={listOutcome}
              onMissingToList={handleMissingToList}
            />
          )}
          {almost.length > 0 && (
            <MatchSection
              kind="almost"
              title={m.quaseProntasTitulo}
              matches={almost}
              listPending={listPending}
              listOutcome={listOutcome}
              onMissingToList={handleMissingToList}
            />
          )}

          <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-border p-4">
            <p className="text-sm text-muted">{m.criarComDespensaDica}</p>
            <Button asChild variant="secondary">
              <Link href={createHref}>
                <Sparkles className="size-4" aria-hidden />
                {m.criarComDespensa}
              </Link>
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}

function MatchSection({
  kind,
  title,
  matches,
  listPending,
  listOutcome,
  onMissingToList,
}: {
  kind: 'ready' | 'almost'
  title: string
  matches: PantryMatch[]
  listPending: string | null
  listOutcome: ListOutcome | null
  onMissingToList: (recipeId: string) => Promise<void>
}) {
  const { locale, messages } = useLocale()
  const m = messages.despensa
  const aiLabel = messages.busca.imagemSeloIa
  return (
    <div className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 font-medium text-fg">
        {kind === 'ready' ? (
          <ChefHat className="size-4 text-brand-ink" aria-hidden />
        ) : (
          <ShoppingCart className="size-4 text-brand-ink" aria-hidden />
        )}
        {title}
      </h3>
      <ul className="grid gap-3 sm:grid-cols-2">
        {matches.map((r) => {
          const outcome = listOutcome?.recipeId === r.id ? listOutcome : null
          return (
            <li key={r.id} className="flex min-w-0 gap-3 rounded-xl border border-border bg-surface p-3 shadow-sm">
              <MealPlanThumb
                imageUrl={r.imageUrl}
                aiGenerated={r.imageAiGenerated}
                aiLabel={aiLabel}
                className="size-16"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Link
                  href={recipeDetailPath(locale, r.slug ?? r.id)}
                  className="truncate font-medium text-fg hover:text-brand-ink"
                >
                  {r.name}
                </Link>
                <p className="text-xs text-muted">
                  {m.temDeTotal.replace('{n}', String(r.covered)).replace('{total}', String(r.total))}
                </p>
                {r.missing.length > 0 && (
                  <p className="text-sm text-fg">{m.falta.replace('{lista}', () => r.missing.join(', '))}</p>
                )}
                {/* ADR-0040: toda Receita do resultado pode ir pro Cardápio (o gate é o mesmo de Salvar,
                    ADR-0038 dec.4); "pôr o que falta" só quando falta algo. */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <PantryPlanButton recipeId={r.id} recipeName={r.name} label={m.porNoCardapio} />
                  {r.missing.length > 0 && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={listPending != null}
                        aria-label={`${listPending === r.id ? m.pondoNaLista : m.porNaLista}: ${r.name}`}
                        onClick={() => void onMissingToList(r.id)}
                      >
                        {listPending === r.id ? m.pondoNaLista : m.porNaLista}
                      </Button>
                      {outcome != null && 'listId' in outcome && (
                        <span role="status" className="text-xs text-muted">
                          {m.postoNaLista.replace('{lista}', () => outcome.listName)}{' '}
                          <Link
                            href={`/me/shopping-lists/${outcome.listId}`}
                            className="font-medium text-brand-ink underline-offset-4 hover:underline"
                          >
                            {m.abrirLista}
                          </Link>
                        </span>
                      )}
                      {outcome != null && 'error' in outcome && (
                        <span role="alert" className="text-xs font-medium text-fg">
                          {outcome.error}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** "Pôr no cardápio" de um card do resultado: o mesmo painel do detalhe, nas porções da Receita. */
function PantryPlanButton({ recipeId, recipeName, label }: { recipeId: string; recipeName: string; label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={open}
          aria-label={`${label}: ${recipeName}`}
          onClick={() => setOpen((v) => !v)}
        >
          <CalendarPlus aria-hidden />
          {label}
        </Button>
      </PopoverAnchor>
      <PopoverContent>
        <PlanRecipePanel recipeId={recipeId} porcoes={null} />
      </PopoverContent>
    </Popover>
  )
}
