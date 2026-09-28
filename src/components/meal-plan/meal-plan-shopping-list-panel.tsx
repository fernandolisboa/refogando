'use client'
/**
 * "Gerar lista de compras" do Cardápio (ADR-0035 dec.5). Escolhe o PERÍODO (semana inteira, ou de
 * hoje até domingo quando a semana visível é a atual e já começou) e a LISTA de destino (uma
 * existente ou uma nova, com nome sugerido pela semana), e dispara UM `POST
 * /api/me/meal-plan/shopping-list`: o servidor soma os ingredientes de todas as Refeições planejadas,
 * cada uma nas SUAS porções, pelo mesmo merge da Lista de compras (ADR-0032).
 *
 * A lista NOVA vai pelo nome no mesmo POST (o servidor só a cria se o período tiver refeições — sem
 * lista órfã). O `<select>` é NATIVO como na barra de multi-adicionar (lista curta, testável sem portal).
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { SHOPPING_LIST_NAME_MAX } from '@/domain/shopping-list'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Messages } from '@/i18n/messages'
import { shoppingListCreateErrorMessage } from '@/components/shopping-list/shopping-list-errors'
import { formatNumericDate } from './meal-plan-format'

type ListOption = { id: string; name: string }
type Status = 'loading' | 'idle' | 'error'
type Result = {
  listId: string
  listName: string
  addedCount: number
  skippedCount: number
  semPorcoesCount: number
}

const NEW_LIST_VALUE = '__nova_lista__'

function errorMessage(code: string | undefined, ml: Messages['listaDeCompras'], m: Messages['cardapio']) {
  return code === 'plano_vazio' ? m.erroPlanoVazio : shoppingListCreateErrorMessage(code, ml, m.erroGerar)
}

export function MealPlanShoppingListPanel({
  weekStart,
  weekEnd,
  today,
}: {
  weekStart: string
  weekEnd: string
  today: string
}) {
  const { locale, messages } = useLocale()
  const m = messages.cardapio
  const ml = messages.listaDeCompras

  // "De hoje até domingo" só faz sentido com hoje DENTRO da semana e depois da segunda.
  const canStartToday = today > weekStart && today <= weekEnd
  const [period, setPeriod] = useState<'week' | 'fromToday'>(canStartToday ? 'fromToday' : 'week')
  const [lists, setLists] = useState<ListOption[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [selected, setSelected] = useState<string>(NEW_LIST_VALUE)
  const defaultName = m.nomeListaPadrao.replace('{data}', () => formatNumericDate(weekStart, locale))
  const [newName, setNewName] = useState(defaultName)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/me/shopping-lists')
        if (!res.ok) {
          if (!cancelled) setStatus('error')
          return
        }
        const body = (await res.json()) as { lists: ListOption[] }
        if (cancelled) return
        setLists(body.lists.map((l) => ({ id: l.id, name: l.name })))
        // Já gerou pra esta semana antes? A lista com o nome sugerido vem pré-escolhida (senão
        // "Nova lista" daria nome_duplicado).
        const same = body.lists.find((l) => l.name === defaultName)
        if (same) setSelected(same.id)
        setStatus('idle')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [defaultName])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const criando = selected === NEW_LIST_VALUE
      const from = period === 'fromToday' && canStartToday ? today : weekStart
      const res = await fetch(`/api/me/meal-plan/shopping-list?locale=${encodeURIComponent(locale)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          to: weekEnd,
          ...(criando ? { newListName: newName } : { listId: selected }),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(errorMessage(body.error, ml, m))
        return
      }
      const body = (await res.json()) as {
        list: { id: string; name: string }
        addedCount: number
        skippedCount: number
        semPorcoesCount: number
      }
      if (criando) {
        // A lista nova vira opção existente: gerar de novo soma nela em vez de tentar recriá-la.
        setLists((prev) => [...prev, body.list])
        setSelected(body.list.id)
      }
      setResult({
        listId: body.list.id,
        listName: body.list.name,
        addedCount: body.addedCount,
        skippedCount: body.skippedCount,
        semPorcoesCount: body.semPorcoesCount,
      })
    } catch {
      setError(m.erroGerar)
    } finally {
      setSubmitting(false)
    }
  }

  const selectClass = 'h-9 rounded-md border border-border bg-surface px-2 text-sm text-fg shadow-sm'
  const criandoNova = selected === NEW_LIST_VALUE

  return (
    <section
      aria-labelledby="cardapio-gerar-lista-titulo"
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="cardapio-gerar-lista-titulo" className="font-display text-base font-semibold text-fg">
          {m.gerarLista}
        </h2>
        <p className="text-sm text-muted">{m.gerarListaDescricao}</p>
      </div>

      {status === 'loading' && (
        <p aria-busy="true" className="text-sm text-muted">
          {messages.system.loading}
        </p>
      )}
      {status === 'error' && (
        <p role="alert" className="text-sm font-medium text-fg">
          {ml.erroCarregarListas}
        </p>
      )}

      {status === 'idle' && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {canStartToday && (
            <fieldset className="flex flex-wrap items-center gap-4 text-sm text-fg">
              <legend className="sr-only">{m.periodo}</legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="cardapio-periodo"
                  checked={period === 'fromToday'}
                  onChange={() => setPeriod('fromToday')}
                />
                {m.deHojeEmDiante}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="cardapio-periodo"
                  checked={period === 'week'}
                  onChange={() => setPeriod('week')}
                />
                {m.semanaInteira}
              </label>
            </fieldset>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              {m.listaDestino}
              <select
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value)
                  setError(null)
                }}
                className={selectClass}
              >
                <option value={NEW_LIST_VALUE}>{ml.novaLista}</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            {criandoNova && (
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                {ml.nomeNovaLista}
                <Input
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value)
                    setError(null)
                  }}
                  maxLength={SHOPPING_LIST_NAME_MAX}
                  className="w-64"
                />
              </label>
            )}
            <Button type="submit" disabled={submitting || (criandoNova && newName.trim() === '')}>
              {submitting ? m.gerando : m.gerarLista}
            </Button>
          </div>
        </form>
      )}

      {error != null && (
        <p role="alert" className="text-sm font-medium text-fg">
          {error}
        </p>
      )}

      {result != null && (
        <div role="status" aria-live="polite" className="flex flex-col gap-1 text-sm text-fg">
          <p>
            {(result.addedCount === 1 ? m.listaGeradaSingular : m.listaGerada)
              .replace('{n}', String(result.addedCount))
              .replace('{lista}', () => result.listName)}{' '}
            <Link
              href={`/me/shopping-lists/${result.listId}`}
              className="font-medium text-brand-ink underline-offset-4 hover:underline"
            >
              {m.abrirLista}
            </Link>
          </p>
          {result.semPorcoesCount > 0 && (
            <p className="text-muted">{(result.semPorcoesCount === 1 ? m.avisoSemPorcoesSingular : m.avisoSemPorcoes).replace('{n}', String(result.semPorcoesCount))}</p>
          )}
          {result.skippedCount > 0 && <p className="text-muted">{m.algumasIndisponiveis}</p>}
        </div>
      )}
    </section>
  )
}
