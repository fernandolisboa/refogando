'use client'
/**
 * Seletor de Receita do Cardápio (ADR-0035 dec.4): "Adicionar" num dia abre este modal com as
 * Receitas do PRÓPRIO acervo do usuário — Salvos (`/api/me/saved`) + Minhas criações
 * (`/api/me/recipes`), deduplicadas, filtráveis por nome. Escolhe dia + refeição e planeja com UM
 * toque (`POST /api/me/meal-plan/entries`). As porções começam nas da Receita (o ajuste é na linha,
 * depois; re-planejar a mesma Receita na mesma refeição mantém as porções já ajustadas). Planejar
 * direto de QUALQUER Receita pública é o botão de calendário do detalhe (`RecipeMealPlanButton`).
 *
 * "Sem receita" (ADR-0037): no mesmo dia + refeição, uma Anotação livre ("jantar fora", "sobras") —
 * digitada ou por um dos atalhos — vai pelo mesmo `POST .../entries` com `note` no lugar de `recipeId`.
 *
 * O acervo é carregado na PRIMEIRA abertura e reaproveitado nas seguintes (planejar a semana são
 * vários cliques; os dois endpoints devolvem o acervo inteiro). Minhas criações traz também o que não
 * é planejável: filtrado por `passesOwnRecipeBarriers`, o MESMO critério do gate do servidor.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { MEAL_PLAN_NOTE_MAX, MEAL_SLOTS, parsePlanNote, type MealSlot } from '@/domain/meal-plan'
import { passesOwnRecipeBarriers } from '@/domain/recipe-pool'
import type { RecipeListItem } from '@/domain/recipe-list-read'
import { formatShortDay, mealPlanErrorMessage, mealSlotLabel, slotForNow } from './meal-plan-format'
import { MealPlanThumb } from './meal-plan-thumb'

type Candidate = Pick<RecipeListItem, 'id' | 'name' | 'imageUrl' | 'imageAiGenerated'>
/** Marca de "enviando uma Anotação" em `busyId` (nunca colide com um uuid de Receita). */
const NOTE_BUSY = 'note'
type Status = 'unloaded' | 'loading' | 'idle' | 'error'

/** Minúsculas sem acento — "feijão" casa "feijao". */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

async function fetchCandidates(locale: string): Promise<Candidate[] | null> {
  const q = `?locale=${encodeURIComponent(locale)}`
  const [saved, mine] = await Promise.all([fetch(`/api/me/saved${q}`), fetch(`/api/me/recipes${q}`)])
  if (!saved.ok || !mine.ok) return null
  const a = ((await saved.json()) as { recipes: RecipeListItem[] }).recipes
  const b = ((await mine.json()) as { recipes: RecipeListItem[] }).recipes
  const seen = new Set<string>()
  const merged: Candidate[] = []
  for (const r of [...a, ...b]) {
    if (seen.has(r.id)) continue
    if (!passesOwnRecipeBarriers({ resultKind: r.resultKind, moderationRemoved: r.moderationRemovida, origin: r.origin })) {
      continue
    }
    seen.add(r.id)
    merged.push({ id: r.id, name: r.name, imageUrl: r.imageUrl, imageAiGenerated: r.imageAiGenerated })
  }
  return merged
}

export function MealPlanRecipePicker({
  open,
  onOpenChange,
  initialDay,
  days,
  onPlanned,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialDay: string
  days: string[]
  onPlanned: () => void
}) {
  const { locale, messages } = useLocale()
  const m = messages.cardapio
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [status, setStatus] = useState<Status>('unloaded')

  // Fechar o seletor NÃO descarta uma carga em voo (senão o status ficaria preso em 'loading' e a
  // reabertura não buscaria de novo); só desmontar descarta.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Carrega na 1ª abertura (e de novo só depois de um erro); fechar/reabrir reusa o que veio.
  useEffect(() => {
    if (!open || (status !== 'unloaded' && status !== 'error')) return
    const t = setTimeout(() => {
      setStatus('loading')
      fetchCandidates(locale)
        .then((list) => {
          if (!mounted.current) return
          if (list == null) setStatus('error')
          else {
            setCandidates(list)
            setStatus('idle')
          }
        })
        .catch(() => {
          if (mounted.current) setStatus('error')
        })
    }, 0)
    return () => clearTimeout(t)
    // `status` fora das deps de propósito: só a abertura dispara (um erro re-tenta na próxima abertura).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, locale])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="center" closeLabel={m.fechar} className="gap-5">
        <SheetHeader>
          <SheetTitle>{m.escolherReceita}</SheetTitle>
          <SheetDescription>{m.escolherReceitaDescricao}</SheetDescription>
        </SheetHeader>
        {/* Monta o corpo só aberto: cada abertura recomeça do dia clicado (busca e refeição limpas). */}
        {open && (
          <PickerBody
            key={initialDay}
            initialDay={initialDay}
            days={days}
            locale={locale}
            candidates={candidates}
            status={status === 'unloaded' ? 'loading' : status}
            onPlanned={onPlanned}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function PickerBody({
  initialDay,
  days,
  locale,
  candidates,
  status,
  onPlanned,
}: {
  initialDay: string
  days: string[]
  locale: string
  candidates: Candidate[]
  status: 'loading' | 'idle' | 'error'
  onPlanned: () => void
}) {
  const { messages } = useLocale()
  const m = messages.cardapio
  const [query, setQuery] = useState('')
  const [day, setDay] = useState(initialDay)
  const [slot, setSlot] = useState<MealSlot>(() => slotForNow())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const noteError = m.erroAnotacao.replace('{max}', String(MEAL_PLAN_NOTE_MAX))

  const filtered = useMemo(() => {
    const q = fold(query)
    return q === '' ? candidates : candidates.filter((c) => fold(c.name).includes(q))
  }, [candidates, query])

  // `busyId` marca o que está sendo enviado: o id da Receita, ou `NOTE_BUSY` pra uma Anotação.
  async function submit(busy: string, payload: { recipeId: string } | { note: string }) {
    if (busyId != null) return
    setBusyId(busy)
    setError(null)
    try {
      const res = await fetch('/api/me/meal-plan/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, day, slot }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(
          'note' in payload && body.error === 'dados_invalidos' ? noteError : mealPlanErrorMessage(body.error, m),
        )
        return
      }
      onPlanned()
    } catch {
      setError(m.erroSalvar)
    } finally {
      setBusyId(null)
    }
  }

  function plan(recipeId: string) {
    void submit(recipeId, { recipeId })
  }

  function planNote(text: string) {
    const parsed = parsePlanNote(text)
    if (parsed === 'invalid') {
      setError(noteError)
      return
    }
    void submit(NOTE_BUSY, { note: parsed })
  }

  const selectClass = 'h-9 rounded-md border border-border bg-surface px-2 text-sm text-fg shadow-sm'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          {m.dia}
          <select value={day} onChange={(e) => setDay(e.target.value)} className={selectClass}>
            {days.map((d) => (
              <option key={d} value={d}>
                {formatShortDay(d, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          {m.refeicao}
          <select value={slot} onChange={(e) => setSlot(e.target.value as MealSlot)} className={selectClass}>
            {MEAL_SLOTS.map((s) => (
              <option key={s} value={s}>
                {mealSlotLabel(s, m)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <form
        className="flex flex-col gap-2 rounded-lg border border-border p-3"
        onSubmit={(e) => {
          e.preventDefault()
          planNote(note)
        }}
      >
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{m.anotacaoTitulo}</h3>
        <label htmlFor="cardapio-anotacao" className="sr-only">
          {m.anotacaoRotulo}
        </label>
        <div className="flex gap-2">
          <Input
            id="cardapio-anotacao"
            value={note}
            maxLength={MEAL_PLAN_NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            placeholder={m.anotacaoPlaceholder}
            aria-describedby="cardapio-anotacao-dica"
          />
          <Button type="submit" variant="outline" disabled={busyId != null || note.trim() === ''}>
            {busyId === NOTE_BUSY ? m.anotando : m.anotar}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {m.anotacaoSugestoes.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busyId != null}
              aria-label={m.anotarRapido.replace('{texto}', () => s)}
              onClick={() => planNote(s)}
              className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg hover:border-brand-ink hover:bg-brand/10 disabled:opacity-60"
            >
              {s}
            </button>
          ))}
        </div>
        <p id="cardapio-anotacao-dica" className="text-xs text-muted">
          {m.anotacaoDica}
        </p>
      </form>

      <div className="flex flex-col gap-1">
        <label htmlFor="cardapio-buscar" className="sr-only">
          {m.buscarReceita}
        </label>
        <Input
          id="cardapio-buscar"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={m.buscarReceita}
        />
      </div>

      <div aria-live="polite" className="text-sm text-muted">
        {status === 'loading' && <p>{messages.system.loading}</p>}
        {status === 'error' && (
          <p role="alert" className="font-medium text-fg">
            {m.erroCarregarReceitas}
          </p>
        )}
        {status === 'idle' && candidates.length === 0 && (
          <p className="flex flex-wrap items-center gap-2">
            {m.semReceitas}{' '}
            <Link href="/" className="font-medium text-brand-ink underline-offset-4 hover:underline">
              {m.explorar}
            </Link>
          </p>
        )}
        {status === 'idle' && candidates.length > 0 && filtered.length === 0 && <p>{m.semResultados}</p>}
      </div>

      {error != null && (
        <p role="alert" className="text-sm font-medium text-fg">
          {error}
        </p>
      )}

      {filtered.length > 0 && (
        <ul className="flex max-h-[45vh] flex-col gap-1 overflow-y-auto pr-1">
          {filtered.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={busyId != null}
                onClick={() => plan(c.id)}
                className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-brand/10 disabled:opacity-60"
              >
                <MealPlanThumb
                  imageUrl={c.imageUrl}
                  aiGenerated={c.imageAiGenerated}
                  aiLabel={messages.busca.imagemSeloIa}
                  className="size-10"
                />
                <span className="flex-1 text-sm font-medium text-fg">{c.name}</span>
                <span className="text-xs font-medium text-brand-ink">
                  {busyId === c.id ? m.planejando : m.planejar}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
