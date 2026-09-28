'use client'
/**
 * "Sugerir com IA" do Cardápio (ADR-0036). Três estados:
 *  1. PEDIDO — dias da semana visível, refeições, porções, restrições (filtro duro, declaradas nas
 *     receitas), de onde vêm as receitas, "só preencher vazias" e uma nota livre;
 *  2. PRÉVIA — `POST /api/me/meal-plan/suggestions` devolve as Receitas escolhidas por dia × refeição,
 *     com um motivo curto. Nada foi gravado: cada item tem um checkbox;
 *  3. ACEITE — `POST /api/me/meal-plan/suggestions/apply` com os marcados (o servidor re-valida tudo) e
 *     `onApplied` recarrega a semana.
 *
 * A chamada à IA pode levar dezenas de segundos: fechar o painel (desmontar) aborta o fetch, e o
 * servidor propaga o abort até a Anthropic. Porções ficam lembradas no navegador (conveniência; o
 * storage pode faltar, então todo acesso tem try/catch).
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MEAL_PLAN_PORCOES_MAX, MEAL_PLAN_PORCOES_MIN, MEAL_SLOTS, type MealSlot } from '@/domain/meal-plan'
import { MENU_NOTE_MAX, type MenuSource } from '@/domain/menu-suggestion'
import { RESTRICOES, type Restricao } from '@/domain/vocabulary'
import { recipeDetailPath } from '@/domain/recipe-detail-route'
import type { Messages } from '@/i18n/messages'
import { capitalizeFirst, formatShortDay, formatWeekday, mealSlotLabel } from './meal-plan-format'
import { MealPlanThumb } from './meal-plan-thumb'

type M = Messages['cardapio']

export type SuggestionItem = {
  day: string
  slot: MealSlot
  motivo: string
  recipe: { id: string; name: string; slug?: string; imageUrl?: string; imageAiGenerated?: boolean }
}
type Preview = { items: SuggestionItem[]; comentario: string; targetCount: number }
type Phase = 'form' | 'loading' | 'preview'

const PORCOES_STORAGE_KEY = 'refogando.cardapio.sugestao.porcoes'
const DEFAULT_PORCOES = 2
const DEFAULT_SLOTS: MealSlot[] = ['almoco', 'jantar']

function readStoredPorcoes(): number {
  try {
    const n = Number(window.localStorage.getItem(PORCOES_STORAGE_KEY))
    return Number.isInteger(n) && n >= MEAL_PLAN_PORCOES_MIN && n <= MEAL_PLAN_PORCOES_MAX ? n : DEFAULT_PORCOES
  } catch {
    return DEFAULT_PORCOES
  }
}

function storePorcoes(n: number): void {
  try {
    window.localStorage.setItem(PORCOES_STORAGE_KEY, String(n))
  } catch {
    // Sem storage (aba privada, bloqueado): só não lembra.
  }
}

function parsePorcoesText(text: string): number | null {
  const n = Number(text)
  return text.trim() !== '' && Number.isInteger(n) && n >= MEAL_PLAN_PORCOES_MIN && n <= MEAL_PLAN_PORCOES_MAX
    ? n
    : null
}

function itemKey(i: Pick<SuggestionItem, 'day' | 'slot'>): string {
  return `${i.day}|${i.slot}`
}

function formatWait(ms: number, m: M): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  return minutes >= 60
    ? m.tempoHoras.replace('{n}', String(Math.ceil(minutes / 60)))
    : m.tempoMinutos.replace('{n}', String(minutes))
}

function suggestErrorMessage(code: string | undefined, retryAfterMs: number | undefined, m: M): string {
  switch (code) {
    case 'dados_invalidos':
      return m.erroSugestaoPedido
    case 'nada_a_preencher':
      return m.erroSugestaoNadaAPreencher
    case 'sem_candidatas':
      return m.erroSugestaoSemCandidatas
    case 'limite_sugestao':
      return m.erroSugestaoLimite.replace('{tempo}', () => formatWait(retryAfterMs ?? 0, m))
    default:
      return m.erroSugestaoFalhou
  }
}

export function MealPlanSuggestPanel({
  days,
  today,
  onApplied,
}: {
  /** Os 7 dias (segunda → domingo) da semana visível. */
  days: string[]
  today: string
  onApplied: () => void
}) {
  const { locale, messages } = useLocale()
  const m = messages.cardapio

  // Semana atual: de hoje em diante (dias passados raramente se planejam); outra semana: inteira.
  const [selectedDays, setSelectedDays] = useState<string[]>(() =>
    days.includes(today) ? days.filter((d) => d >= today) : days,
  )
  const [slots, setSlots] = useState<MealSlot[]>(DEFAULT_SLOTS)
  // Texto livre no campo (apagar pra digitar outro número não pode virar "1" no meio); validado ao pedir.
  const [porcoesText, setPorcoesText] = useState<string>(() => String(readStoredPorcoes()))
  const porcoes = parsePorcoesText(porcoesText)
  const [restricoes, setRestricoes] = useState<Restricao[]>([])
  const [source, setSource] = useState<MenuSource>('all')
  const [onlyEmpty, setOnlyEmpty] = useState(true)
  const [note, setNote] = useState('')

  const [phase, setPhase] = useState<Phase>('form')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<{ addedCount: number; skippedCount: number } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const resultRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])
  // A prévia (e o resultado do aceite) aparece longe do botão: o foco vai até ela.
  useEffect(() => {
    if (phase === 'preview') previewRef.current?.focus()
  }, [phase, preview])
  useEffect(() => {
    if (applied != null) resultRef.current?.focus()
  }, [applied])

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
  }

  async function handleSuggest(e?: React.FormEvent) {
    e?.preventDefault()
    if (phase === 'loading') return
    if (selectedDays.length === 0 || slots.length === 0) {
      setError(m.erroSugestaoDados)
      return
    }
    if (porcoes == null) {
      setError(m.erroSugestaoPorcoes)
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setApplied(null)
    setPhase('loading')
    storePorcoes(porcoes)
    try {
      const res = await fetch(`/api/me/meal-plan/suggestions?locale=${encodeURIComponent(locale)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ days: selectedDays, slots, porcoes, restricoes, source, onlyEmpty, note }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; retryAfterMs?: number }
        setError(suggestErrorMessage(body.error, body.retryAfterMs, m))
        setPhase('form')
        return
      }
      const body = (await res.json()) as Preview
      setPreview(body)
      setChecked(new Set(body.items.map(itemKey)))
      setPhase('preview')
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return
      setError(m.erroSugestaoFalhou)
      setPhase('form')
    }
  }

  async function handleApply() {
    if (!preview || applying || porcoes == null) return
    const entries = preview.items
      .filter((i) => checked.has(itemKey(i)))
      .map((i) => ({ recipeId: i.recipe.id, day: i.day, slot: i.slot, porcoes }))
    if (entries.length === 0) return
    setApplying(true)
    setError(null)
    try {
      const res = await fetch('/api/me/meal-plan/suggestions/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entries }),
      })
      if (!res.ok) {
        setError(m.erroSugestaoAceitar)
        return
      }
      const body = (await res.json()) as { addedCount: number; skippedCount: number }
      setApplied(body)
      setPreview(null)
      setPhase('form')
      onApplied()
    } catch {
      setError(m.erroSugestaoAceitar)
    } finally {
      setApplying(false)
    }
  }

  const selectedCount = preview ? preview.items.filter((i) => checked.has(itemKey(i))).length : 0
  const checkboxClass = 'size-4 accent-brand-strong'
  const chipClass =
    'flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm text-fg has-[:checked]:border-brand has-[:checked]:bg-brand/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand'

  return (
    <section
      aria-labelledby="cardapio-sugerir-titulo"
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="cardapio-sugerir-titulo" className="flex items-center gap-2 font-display text-base font-semibold text-fg">
          <Sparkles className="size-4 text-brand-ink" aria-hidden />
          {m.sugerirTitulo}
        </h2>
        <p className="text-sm text-muted">{phase === 'preview' ? m.sugestaoPreviaDescricao : m.sugerirDescricao}</p>
      </div>

      {phase !== 'preview' && (
        <form onSubmit={handleSuggest} aria-busy={phase === 'loading'} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2" disabled={phase === 'loading'}>
            <legend className="mb-1 text-xs font-medium text-muted">{m.sugerirDias}</legend>
            <div className="flex flex-wrap gap-2">
              {days.map((d) => (
                <label key={d} className={chipClass}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={selectedDays.includes(d)}
                    onChange={() => setSelectedDays((prev) => toggle(prev, d))}
                  />
                  {capitalizeFirst(formatShortDay(d, locale))}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2" disabled={phase === 'loading'}>
            <legend className="mb-1 text-xs font-medium text-muted">{m.sugerirRefeicoes}</legend>
            <div className="flex flex-wrap gap-2">
              {MEAL_SLOTS.map((s) => (
                <label key={s} className={chipClass}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={slots.includes(s)}
                    onChange={() => setSlots((prev) => toggle(prev, s))}
                  />
                  {mealSlotLabel(s, m)}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2" disabled={phase === 'loading'}>
            <legend className="mb-1 text-xs font-medium text-muted">{m.sugerirRestricoes}</legend>
            <div className="flex flex-wrap gap-2">
              {RESTRICOES.map((r) => (
                <label key={r} className={chipClass}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={restricoes.includes(r)}
                    onChange={() => setRestricoes((prev) => toggle(prev, r))}
                  />
                  {messages.restricaoLabel[r]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              {m.sugerirPorcoes}
              <Input
                type="number"
                min={MEAL_PLAN_PORCOES_MIN}
                max={MEAL_PLAN_PORCOES_MAX}
                step={1}
                value={porcoesText}
                disabled={phase === 'loading'}
                onChange={(e) => setPorcoesText(e.target.value)}
                className="w-24"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              {m.sugerirFonte}
              <select
                value={source}
                disabled={phase === 'loading'}
                onChange={(e) => setSource(e.target.value as MenuSource)}
                className="h-9 rounded-md border border-border bg-surface px-2 text-sm text-fg shadow-sm"
              >
                <option value="all">{m.sugerirFonteTodas}</option>
                <option value="mine">{m.sugerirFonteMinhas}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm text-fg">
              <input
                type="checkbox"
                className={checkboxClass}
                checked={onlyEmpty}
                disabled={phase === 'loading'}
                onChange={(e) => setOnlyEmpty(e.target.checked)}
              />
              {m.sugerirSoVazias}
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            {m.sugerirNota}
            <Input
              value={note}
              maxLength={MENU_NOTE_MAX}
              placeholder={m.sugerirNotaPlaceholder}
              disabled={phase === 'loading'}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={phase === 'loading'}>
              <Sparkles aria-hidden />
              {m.sugerirEnviar}
            </Button>
            {phase === 'loading' && <p className="text-sm text-muted">{m.sugerindo}</p>}
          </div>
        </form>
      )}

      {phase === 'preview' && preview != null && (
        <div ref={previewRef} tabIndex={-1} className="flex flex-col gap-4 outline-none">
          {preview.comentario !== '' && <p className="text-sm text-fg">{preview.comentario}</p>}
          {preview.items.length === 0 ? (
            <p className="text-sm text-muted">{m.sugestaoVazia}</p>
          ) : (
            <>
              {preview.items.length < preview.targetCount && (
                <p className="text-sm text-muted">
                  {m.sugestaoParcial
                    .replace('{n}', String(preview.items.length))
                    .replace('{total}', String(preview.targetCount))}
                </p>
              )}
              <ul className="flex flex-col gap-2">
                {preview.items.map((item) => (
                  <PreviewRow
                    key={itemKey(item)}
                    item={item}
                    checked={checked.has(itemKey(item))}
                    onToggle={() =>
                      setChecked((prev) => {
                        const next = new Set(prev)
                        if (next.has(itemKey(item))) next.delete(itemKey(item))
                        else next.add(itemKey(item))
                        return next
                      })
                    }
                    m={m}
                    locale={locale}
                  />
                ))}
              </ul>
            </>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {preview.items.length > 0 && (
              <Button type="button" disabled={applying || selectedCount === 0} onClick={() => void handleApply()}>
                {applying
                  ? m.sugestaoAceitando
                  : selectedCount === 1
                    ? m.sugestaoAceitarSingular
                    : m.sugestaoAceitar.replace('{n}', String(selectedCount))}
              </Button>
            )}
            <Button type="button" variant="outline" disabled={applying} onClick={() => void handleSuggest()}>
              {m.sugestaoDeNovo}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={applying}
              onClick={() => {
                setPreview(null)
                setPhase('form')
              }}
            >
              {m.sugestaoAjustar}
            </Button>
          </div>
        </div>
      )}

      {error != null && (
        <p role="alert" className="text-sm font-medium text-fg">
          {error}
        </p>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {phase === 'loading' ? m.sugerindo : ''}
      </div>

      {applied != null && (
        <div ref={resultRef} tabIndex={-1} className="flex flex-col gap-1 text-sm text-fg outline-none">
          <p>
            {applied.addedCount === 1
              ? m.sugestaoAdicionadaSingular
              : m.sugestaoAdicionada.replace('{n}', String(applied.addedCount))}
          </p>
          {applied.skippedCount > 0 && (
            <p className="text-muted">
              {applied.skippedCount === 1
                ? m.sugestaoPuladasSingular
                : m.sugestaoPuladas.replace('{n}', String(applied.skippedCount))}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function PreviewRow({
  item,
  checked,
  onToggle,
  m,
  locale,
}: {
  item: SuggestionItem
  checked: boolean
  onToggle: () => void
  m: M
  locale: string
}) {
  const aiLabel = useLocale().messages.busca.imagemSeloIa
  const weekday = capitalizeFirst(formatWeekday(item.day, locale))
  const slot = mealSlotLabel(item.slot, m)
  return (
    <li className="flex items-start gap-3">
      <input
        type="checkbox"
        className="mt-1 size-4 shrink-0 accent-brand-strong"
        checked={checked}
        onChange={onToggle}
        aria-label={m.sugestaoIncluir
          .replace('{nome}', () => item.recipe.name)
          .replace('{dia}', () => weekday)
          .replace('{refeicao}', () => slot)}
      />
      <MealPlanThumb
        imageUrl={item.recipe.imageUrl}
        aiGenerated={item.recipe.imageAiGenerated}
        aiLabel={aiLabel}
        className="size-12"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">
          {capitalizeFirst(formatShortDay(item.day, locale))} · {slot}
        </span>
        <Link
          href={recipeDetailPath(locale, item.recipe.slug ?? item.recipe.id)}
          target="_blank"
          rel="noopener"
          className="line-clamp-2 text-sm font-medium leading-snug text-fg hover:text-brand-ink"
        >
          {item.recipe.name}
          <span className="sr-only"> {m.abreNovaAba}</span>
        </Link>
        {item.motivo !== '' && <p className="text-xs text-muted">{item.motivo}</p>}
      </div>
    </li>
  )
}
