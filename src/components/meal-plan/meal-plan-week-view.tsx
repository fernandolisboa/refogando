'use client'
/**
 * Cardápio da semana — a vista do Plano de refeições (ADR-0035). Segunda → domingo, uma coluna por
 * dia (empilhada no celular, grade no desktop), as Refeições planejadas agrupadas por refeição do dia.
 *
 * Consome `GET /api/me/meal-plan?from&to` (a semana), `POST .../entries` (via `MealPlanRecipePicker`),
 * `PATCH/DELETE .../entries/[id]` (porções, mover, tirar) e `POST .../shopping-list` (via
 * `MealPlanShoppingListPanel`) e as rotas de sugestão (via `MealPlanSuggestPanel`, ADR-0036). O servidor é a verdade: toda mutação recarrega a semana depois
 * (otimista só no número de porções, que é o toque mais frequente).
 *
 * ADR-0037: uma entrada pode ser uma Anotação livre ("jantar fora") — mostrada com o texto, sem
 * porções — e "Copiar semana anterior" (`POST .../copy-previous-week`) repete a semana de antes nas
 * refeições vazias (na semana corrente, de hoje em diante).
 *
 * "Hoje" e "esta semana" são do FUSO DO NAVEGADOR (`localTodayIso`, ADR-0035 dec.2) — o servidor
 * nunca deriva o dia. A semana visível vive na URL (`?semana=YYYY-MM-DD`, segunda-feira) pra
 * recarregar/voltar cair na mesma semana.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, CopyPlus, Minus, NotebookPen, Plus, ShoppingCart, Sparkles, X } from 'lucide-react'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  MEAL_PLAN_MAX_DATE,
  MEAL_PLAN_MIN_DATE,
  MEAL_PLAN_PORCOES_MAX,
  MEAL_PLAN_PORCOES_MIN,
  MEAL_SLOTS,
  addDays,
  isPlanDate,
  weekDays,
  weekStartOf,
  type MealSlot,
} from '@/domain/meal-plan'
import { recipeDetailPath } from '@/domain/recipe-detail-route'
import type { Messages } from '@/i18n/messages'
import {
  capitalizeFirst,
  formatDayMonth,
  formatWeekday,
  formatWeekdayShort,
  localTodayIso,
  mealPlanErrorMessage,
  mealSlotLabel,
} from './meal-plan-format'
import { MealPlanRecipePicker } from './meal-plan-recipe-picker'
import { MealPlanThumb } from './meal-plan-thumb'
import { MealPlanShoppingListPanel } from './meal-plan-shopping-list-panel'
import { MealPlanSuggestPanel } from './meal-plan-suggest-panel'
import type { MealPlanEntryView } from '@/server/meal-plan/meal-plan'

/** O shape que `GET /api/me/meal-plan` devolve (fonte única: o tipo do servidor). */
export type MealPlanEntry = MealPlanEntryView

type Status = 'loading' | 'idle' | 'error'
type M = Messages['cardapio']

export function MealPlanWeekView() {
  const { locale, messages } = useLocale()
  const m = messages.cardapio
  const session = useSession()
  const authed = !session.isPending && !session.error && !!session.data
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  // Hoje é fixado no 1º render do cliente (o componente só pinta a semana depois da sessão, então
  // não há descasamento de hidratação); a semana visível vem da URL ou cai na semana de hoje.
  const [today] = useState(() => localTodayIso())
  const currentWeek = weekStartOf(today)
  const semanaParam = searchParams?.get('semana') ?? null
  const weekStart = isPlanDate(semanaParam) ? weekStartOf(semanaParam) : currentWeek
  const days = useMemo(() => weekDays(weekStart), [weekStart])
  const weekEnd = days[6]

  const [entries, setEntries] = useState<MealPlanEntry[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [actionError, setActionError] = useState<string | null>(null)
  const [pickerDay, setPickerDay] = useState<string | null>(null)
  const [showListPanel, setShowListPanel] = useState(false)
  const [showSuggestPanel, setShowSuggestPanel] = useState(false)
  const [copying, setCopying] = useState(false)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Semana visível MAIS RECENTE: uma resposta que chega depois de o usuário trocar de semana é
  // descartada (senão a semana anterior sobrescreveria a da tela).
  const weekRef = useRef(weekStart)
  // Porções já mostradas na tela mas ainda não confirmadas pelo servidor: sobrepostas a qualquer
  // recarga que chegue antes do PATCH (senão o número "voltaria" até a próxima recarga).
  const porcoesOptimistic = useRef(new Map<string, number>())
  const porcoesPending = useRef(new Map<string, number>())
  const porcoesInFlight = useRef(new Set<string>())
  // Há uma recarga em voo? (uma nova aborta a anterior, então no máximo uma.) Um PATCH de porções
  // que volta ANTES dela recarrega de novo: a GET em voo pode ter lido o valor anterior ao PATCH.
  const loadInFlight = useRef(false)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    loadInFlight.current = true
    const url = new URL('/api/me/meal-plan', window.location.origin)
    url.searchParams.set('from', weekStart)
    url.searchParams.set('to', weekEnd)
    url.searchParams.set('locale', locale)
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (weekStart !== weekRef.current) return
      if (!res.ok) {
        setStatus('error')
        return
      }
      const body = (await res.json()) as { entries: MealPlanEntry[] }
      if (weekStart !== weekRef.current) return
      const optimistic = porcoesOptimistic.current
      setEntries(
        body.entries.map((e) => (optimistic.has(e.id) ? { ...e, porcoes: optimistic.get(e.id) ?? null } : e)),
      )
      setStatus('idle')
    } catch (e) {
      if ((e as { name?: string }).name !== 'AbortError') setStatus('error')
    } finally {
      if (abortRef.current === controller) loadInFlight.current = false
    }
  }, [weekStart, weekEnd, locale])

  // Os handlers de mutação chamam SEMPRE a `load` da semana ATUAL (nunca a da semana em que o
  // clique aconteceu, capturada no closure daquele render).
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
    weekRef.current = weekStart
  }, [load, weekStart])

  useEffect(() => {
    if (!authed) return
    // Deferido (espelha SavedRecipesView): setState não roda síncrono no corpo do effect. Troca de
    // semana limpa a anterior (o resumo e o "gerar lista" não contam a semana errada enquanto carrega).
    const t = setTimeout(() => {
      setEntries([])
      setStatus('loading')
      void load()
    }, 0)
    return () => clearTimeout(t)
  }, [authed, load])

  function goToWeek(start: string) {
    setActionError(null)
    setCopyMessage(null)
    setShowListPanel(false)
    setShowSuggestPanel(false)
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (start === currentWeek) params.delete('semana')
    else params.set('semana', start)
    const qs = params.toString()
    router.replace(`${pathname ?? '/me/meal-plan'}${qs ? `?${qs}` : ''}`, { scroll: false })
  }

  async function patchEntry(
    id: string,
    body: Record<string, unknown>,
    opts: { quietNotFound?: boolean } = {},
  ): Promise<boolean> {
    setActionError(null)
    setCopyMessage(null)
    try {
      const res = await fetch(`/api/me/meal-plan/entries/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      // A entrada sumiu (tirada enquanto o PATCH voava): não é erro de quem clicou.
      if (res.status === 404 && opts.quietNotFound) return false
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setActionError(mealPlanErrorMessage(err.error, m))
        return false
      }
      return true
    } catch {
      setActionError(m.erroSalvar)
      return false
    }
  }

  // Porções: cliques rápidos (+ + +) não podem virar PATCHes concorrentes — chegariam fora de ordem e
  // o servidor ficaria com um valor intermediário. Por entrada, UM PATCH em voo; cliques no meio só
  // atualizam o valor pendente, enviado (o último) quando o anterior volta.
  async function handlePorcoes(entry: MealPlanEntry, next: number) {
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, porcoes: next } : e)))
    porcoesOptimistic.current.set(entry.id, next)
    porcoesPending.current.set(entry.id, next)
    if (porcoesInFlight.current.has(entry.id)) return
    porcoesInFlight.current.add(entry.id)
    let ok = true
    try {
      while (ok && porcoesPending.current.has(entry.id)) {
        const value = porcoesPending.current.get(entry.id) as number
        porcoesPending.current.delete(entry.id)
        ok = await patchEntry(entry.id, { porcoes: value }, { quietNotFound: true })
      }
    } finally {
      porcoesPending.current.delete(entry.id)
      porcoesOptimistic.current.delete(entry.id)
      porcoesInFlight.current.delete(entry.id)
    }
    // Falha: recarrega pra desfazer. Sucesso com recarga em voo: ela pode ter lido o valor antigo.
    if (!ok || loadInFlight.current) await loadRef.current()
  }

  async function handleMove(entry: MealPlanEntry, day: string, slot: MealSlot) {
    if (day === entry.day && slot === entry.slot) return
    await patchEntry(entry.id, { day, slot })
    // Sucesso recarrega pra reordenar; falha recarrega pra desfazer o select.
    await loadRef.current()
  }

  // Copia a semana anterior pras refeições vazias desta (na semana corrente, de hoje em diante — os
  // dias que passaram não são preenchidos). O servidor decide o que entra; a semana recarrega.
  async function handleCopyPreviousWeek() {
    if (copying) return
    // A semana do clique: se o usuário trocar de semana com a cópia em voo, o resultado não aparece
    // debaixo da semana errada.
    const clickedWeek = weekStart
    setCopying(true)
    setActionError(null)
    setCopyMessage(null)
    try {
      const res = await fetch('/api/me/meal-plan/copy-previous-week', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(weekStart === currentWeek ? { week: weekStart, fromDay: today } : { week: weekStart }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        addedCount?: number
        skippedCount?: number
      }
      if (clickedWeek !== weekRef.current) return
      if (!res.ok) {
        setActionError(body.error === 'semana_anterior_vazia' ? m.erroCopiaVazia : m.erroCopiar)
        return
      }
      setCopyMessage(copyResultMessage(body.addedCount ?? 0, body.skippedCount ?? 0, m))
      await loadRef.current()
    } catch {
      if (clickedWeek === weekRef.current) setActionError(m.erroCopiar)
    } finally {
      setCopying(false)
    }
  }

  async function handleRemove(entry: MealPlanEntry) {
    setActionError(null)
    setCopyMessage(null)
    setEntries((prev) => prev.filter((e) => e.id !== entry.id))
    try {
      const res = await fetch(`/api/me/meal-plan/entries/${entry.id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) {
        setActionError(m.erroSalvar)
        await loadRef.current()
      }
    } catch {
      setActionError(m.erroSalvar)
      await loadRef.current()
    }
  }

  // ── Guards de sessão ─────────────────────────────────────────────────────────
  if (session.isPending) {
    return (
      <div aria-busy="true" className="text-muted">
        {messages.system.loading}
      </div>
    )
  }
  if (!authed) {
    const returnTo = pathname ?? '/me/meal-plan'
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-muted">{m.precisaEntrar}</p>
        <Button asChild>
          <Link href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>{messages.nav.signIn}</Link>
        </Button>
      </div>
    )
  }

  const isCurrentWeek = weekStart === currentWeek
  const rangeLabel = `${formatDayMonth(weekStart, locale)} – ${formatDayMonth(weekEnd, locale)}`
  const planned = entries.length
  // Anotações não têm ingredientes: sem nenhuma Receita na semana, não há lista a gerar.
  const plannedRecipes = entries.filter((e) => e.note == null).length

  return (
    <div className="flex flex-col gap-6">
      {/* Navegação da semana + resumo + ações. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={m.semanaAnterior}
            disabled={addDays(weekStart, -7) < MEAL_PLAN_MIN_DATE}
            onClick={() => goToWeek(addDays(weekStart, -7))}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <h2 className="min-w-[10rem] text-center font-display text-lg font-semibold text-fg" aria-live="polite">
            {rangeLabel}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={m.proximaSemana}
            disabled={addDays(weekStart, 13) > MEAL_PLAN_MAX_DATE}
            onClick={() => goToWeek(addDays(weekStart, 7))}
          >
            <ChevronRight aria-hidden />
          </Button>
          {!isCurrentWeek && (
            <Button type="button" variant="outline" size="sm" onClick={() => goToWeek(currentWeek)}>
              {m.estaSemana}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status === 'idle' && (
            <span className="text-sm text-muted">
              {planned === 1 ? m.resumoSemanaSingular : m.resumoSemana.replace('{n}', String(planned))}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            title={isCurrentWeek ? m.copiarSemanaDicaHoje : m.copiarSemanaDica}
            disabled={copying || status !== 'idle' || addDays(weekStart, -7) < MEAL_PLAN_MIN_DATE}
            onClick={() => void handleCopyPreviousWeek()}
          >
            <CopyPlus aria-hidden />
            {copying ? m.copiando : m.copiarSemana}
          </Button>
          <Button
            type="button"
            variant={showSuggestPanel ? 'secondary' : 'outline'}
            aria-expanded={showSuggestPanel}
            aria-controls="cardapio-sugerir"
            onClick={() => {
              setShowSuggestPanel((v) => !v)
              setShowListPanel(false)
            }}
          >
            <Sparkles aria-hidden />
            {m.sugerir}
          </Button>
          <Button
            type="button"
            variant={showListPanel ? 'secondary' : 'default'}
            aria-expanded={showListPanel}
            aria-controls="cardapio-gerar-lista"
            disabled={plannedRecipes === 0}
            onClick={() => {
              setShowListPanel((v) => !v)
              setShowSuggestPanel(false)
            }}
          >
            <ShoppingCart aria-hidden />
            {m.gerarLista}
          </Button>
        </div>
      </div>

      {showSuggestPanel && (
        <div id="cardapio-sugerir">
          <MealPlanSuggestPanel
            key={weekStart}
            days={days}
            today={today}
            onApplied={() => void loadRef.current()}
          />
        </div>
      )}

      {showListPanel && plannedRecipes > 0 && (
        <div id="cardapio-gerar-lista">
          <MealPlanShoppingListPanel key={weekStart} weekStart={weekStart} weekEnd={weekEnd} today={today} />
        </div>
      )}

      {copyMessage != null && (
        <p role="status" className="text-sm text-fg">
          {copyMessage}
        </p>
      )}

      {actionError != null && (
        <p role="alert" className="text-sm font-medium text-fg">
          {actionError}
        </p>
      )}

      {status === 'error' && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm font-medium text-fg">
          <p>{m.erroCarregar}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            {messages.system.retry}
          </Button>
        </div>
      )}

      {status === 'idle' && planned === 0 && <p className="text-muted">{m.vazioSemana}</p>}

      <ol
        aria-busy={status === 'loading'}
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
      >
        {days.map((day) => (
          <DayCard
            key={day}
            day={day}
            isToday={day === today}
            entries={entries.filter((e) => e.day === day)}
            weekDaysList={days}
            m={m}
            locale={locale}
            onAdd={() => setPickerDay(day)}
            onPorcoes={handlePorcoes}
            onMove={handleMove}
            onRemove={handleRemove}
          />
        ))}
      </ol>

      <div className="flex flex-wrap gap-4 text-sm">
        <Link href="/me/shopping-lists" className="text-brand-ink underline-offset-4 hover:underline">
          {messages.listaDeCompras.indiceTitulo}
        </Link>
      </div>

      <MealPlanRecipePicker
        open={pickerDay != null}
        onOpenChange={(open) => {
          if (!open) setPickerDay(null)
        }}
        initialDay={pickerDay ?? today}
        days={days}
        onPlanned={() => {
          setPickerDay(null)
          setCopyMessage(null)
          void loadRef.current()
        }}
      />
    </div>
  )
}

/** Resultado do "Copiar semana anterior" numa frase: quantas entraram e, se houver, quantas ficaram de fora. */
export function copyResultMessage(added: number, skipped: number, m: M): string {
  if (added === 0) return m.copiaNada
  const addedText = added === 1 ? m.copiadasSingular : m.copiadas.replace('{n}', String(added))
  if (skipped === 0) return addedText
  const skippedText = skipped === 1 ? m.copiaPuladasSingular : m.copiaPuladas.replace('{n}', String(skipped))
  return `${addedText} ${skippedText}`
}

function DayCard({
  day,
  isToday,
  entries,
  weekDaysList,
  m,
  locale,
  onAdd,
  onPorcoes,
  onMove,
  onRemove,
}: {
  day: string
  isToday: boolean
  entries: MealPlanEntry[]
  weekDaysList: string[]
  m: M
  locale: string
  onAdd: () => void
  onPorcoes: (entry: MealPlanEntry, next: number) => void
  onMove: (entry: MealPlanEntry, day: string, slot: MealSlot) => void
  onRemove: (entry: MealPlanEntry) => void
}) {
  const weekday = capitalizeFirst(formatWeekday(day, locale))
  const headingId = `cardapio-dia-${day}`
  const bySlot = MEAL_SLOTS.map((slot) => ({ slot, items: entries.filter((e) => e.slot === slot) })).filter(
    (g) => g.items.length > 0,
  )

  return (
    <li
      aria-labelledby={headingId}
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-surface p-4 shadow-sm',
        isToday ? 'border-brand/60 ring-1 ring-brand/30' : 'border-border',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={headingId} className="font-display text-base font-semibold text-fg">
          {weekday}
          <span className="ml-2 text-sm font-normal text-muted">{formatDayMonth(day, locale)}</span>
        </h3>
        {isToday && (
          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand-ink">
            {m.hoje}
          </span>
        )}
      </div>

      {bySlot.length === 0 ? (
        <p className="text-sm text-muted">{m.vazioDia}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {bySlot.map((g) => (
            <section key={g.slot} className="flex flex-col gap-1.5">
              <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">
                {mealSlotLabel(g.slot, m)}
              </h4>
              <ul className="flex flex-col gap-2">
                {g.items.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    weekDaysList={weekDaysList}
                    m={m}
                    locale={locale}
                    onPorcoes={onPorcoes}
                    onMove={onMove}
                    onRemove={onRemove}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        aria-label={m.adicionarAoDia.replace('{dia}', () => weekday)}
        onClick={onAdd}
      >
        <Plus aria-hidden />
        {m.adicionar}
      </Button>
    </li>
  )
}

function EntryRow({
  entry,
  weekDaysList,
  m,
  locale,
  onPorcoes,
  onMove,
  onRemove,
}: {
  entry: MealPlanEntry
  weekDaysList: string[]
  m: M
  locale: string
  onPorcoes: (entry: MealPlanEntry, next: number) => void
  onMove: (entry: MealPlanEntry, day: string, slot: MealSlot) => void
  onRemove: (entry: MealPlanEntry) => void
}) {
  const aiLabel = useLocale().messages.busca.imagemSeloIa
  const r = entry.recipe
  const note = entry.note
  const name = note ?? r?.name ?? m.receitaIndisponivel
  // Porções exibidas: as da entrada, senão as da Receita. Sem nenhuma das duas não há o que escalar
  // (a Receita não declara porções) — o seletor some, como o escalador do detalhe.
  const porcoes = entry.porcoes ?? r?.porcoes ?? null
  const moveValue = `${entry.day}|${entry.slot}`

  return (
    <li className="flex items-start gap-3">
      {note != null ? (
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted"
        >
          <NotebookPen className="size-5" />
        </span>
      ) : (
        <MealPlanThumb
          imageUrl={r?.imageUrl}
          aiGenerated={r?.imageAiGenerated}
          aiLabel={aiLabel}
          className="size-12"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {note != null ? (
          <span className="line-clamp-2 text-sm font-medium italic leading-snug text-fg">{note}</span>
        ) : r != null ? (
          <Link
            href={recipeDetailPath(locale, r.slug ?? r.id)}
            className="line-clamp-2 text-sm font-medium leading-snug text-fg hover:text-brand-ink"
          >
            {name}
          </Link>
        ) : (
          <span className="flex flex-col text-sm font-medium text-muted">
            {name}
            <span className="text-xs font-normal">{m.receitaIndisponivelDica}</span>
          </span>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {r != null && porcoes != null && (
            <div className="flex items-center gap-1 text-xs text-muted">
              <button
                type="button"
                aria-label={m.porcoesDiminuir.replace('{nome}', () => name)}
                disabled={porcoes <= MEAL_PLAN_PORCOES_MIN}
                onClick={() => onPorcoes(entry, porcoes - 1)}
                className="inline-flex size-6 items-center justify-center rounded border border-border hover:border-brand-ink disabled:opacity-40"
              >
                <Minus className="size-3" aria-hidden />
              </button>
              <span aria-live="polite" className="min-w-[5.5rem] text-center tabular-nums">
                {porcoes === 1 ? m.porcaoValor : m.porcoesValor.replace('{n}', String(porcoes))}
              </span>
              <button
                type="button"
                aria-label={m.porcoesAumentar.replace('{nome}', () => name)}
                disabled={porcoes >= MEAL_PLAN_PORCOES_MAX}
                onClick={() => onPorcoes(entry, porcoes + 1)}
                className="inline-flex size-6 items-center justify-center rounded border border-border hover:border-brand-ink disabled:opacity-40"
              >
                <Plus className="size-3" aria-hidden />
              </button>
            </div>
          )}
          <label className="sr-only" htmlFor={`mover-${entry.id}`}>
            {m.moverPara.replace('{nome}', () => name)}
          </label>
          <select
            id={`mover-${entry.id}`}
            value={moveValue}
            onChange={(e) => {
              const [day, slot] = e.target.value.split('|') as [string, MealSlot]
              onMove(entry, day, slot)
            }}
            className="h-7 max-w-[12rem] rounded-md border border-border bg-surface px-1.5 text-xs text-fg"
          >
            {weekDaysList.map((d) => (
              <optgroup key={d} label={`${capitalizeFirst(formatWeekday(d, locale))} ${formatDayMonth(d, locale)}`}>
                {MEAL_SLOTS.map((s) => (
                  <option key={s} value={`${d}|${s}`}>
                    {capitalizeFirst(formatWeekdayShort(d, locale))} · {mealSlotLabel(s, m)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>
      <button
        type="button"
        aria-label={m.remover.replace('{nome}', () => name)}
        onClick={() => onRemove(entry)}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-brand/10 hover:text-fg"
      >
        <X className="size-4" aria-hidden />
      </button>
    </li>
  )
}
