'use client'
/**
 * Índice das Listas de compras do usuário (`/me/shopping-lists`, ADR-0035 Consequências). Até aqui
 * uma lista só era alcançável pelo link logo depois de criada — não havia caminho de volta. Lista as
 * Listas (nome + nº de itens), cria uma nova e apaga (com confirmação). Consome
 * `GET/POST /api/me/shopping-lists` e `DELETE /api/me/shopping-lists/[listId]` (ADR-0032).
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ShoppingCart, Trash2 } from 'lucide-react'
import { useLocale } from '@/i18n/provider'
import { SHOPPING_LIST_NAME_MAX } from '@/domain/shopping-list'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { shoppingListCreateErrorMessage } from './shopping-list-errors'

type ListSummary = { id: string; name: string; itemCount: number }
type Status = 'loading' | 'idle' | 'error'

export function ShoppingListsIndex() {
  const { messages } = useLocale()
  const m = messages.listaDeCompras
  const session = useSession()
  const authed = !session.isPending && !session.error && !!session.data
  const pathname = usePathname()

  const [lists, setLists] = useState<ListSummary[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/me/shopping-lists')
      if (!res.ok) {
        setStatus('error')
        return
      }
      const body = (await res.json()) as { lists: ListSummary[] }
      setLists(body.lists)
      setStatus('idle')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    if (!authed) return
    const t = setTimeout(() => {
      void load()
    }, 0)
    return () => clearTimeout(t)
  }, [authed, load])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (creating) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/me/shopping-lists', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(shoppingListCreateErrorMessage(body.error, m))
        return
      }
      setNewName('')
      await load()
    } catch {
      setError(m.erro)
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(list: ListSummary) {
    if (!window.confirm(m.confirmarApagarLista.replace('{nome}', () => list.name))) return
    setError(null)
    setLists((prev) => prev.filter((l) => l.id !== list.id))
    try {
      const res = await fetch(`/api/me/shopping-lists/${list.id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) {
        setError(m.erro)
        await load()
      }
    } catch {
      setError(m.erro)
      await load()
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
    const returnTo = pathname ?? '/me/shopping-lists'
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-muted">{m.precisaEntrar}</p>
        <Button asChild>
          <Link href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>{messages.nav.signIn}</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleCreate} className="flex flex-wrap items-start gap-2">
        <label htmlFor="nova-lista-indice" className="sr-only">
          {m.nomeNovaLista}
        </label>
        <Input
          id="nova-lista-indice"
          value={newName}
          onChange={(e) => {
            setNewName(e.target.value)
            setError(null)
          }}
          placeholder={m.nomeNovaLista}
          maxLength={SHOPPING_LIST_NAME_MAX}
          className="w-64"
        />
        <Button type="submit" variant="secondary" disabled={creating || newName.trim() === ''}>
          {m.criarLista}
        </Button>
      </form>

      {error != null && (
        <p role="alert" className="text-sm font-medium text-fg">
          {error}
        </p>
      )}

      <div aria-live="polite" className="text-sm text-muted">
        {status === 'loading' && <p>{messages.system.loading}</p>}
        {status === 'error' && (
          <p role="alert" className="font-medium text-fg">
            {m.erroCarregarListas}
          </p>
        )}
      </div>

      {status === 'idle' && lists.length === 0 && (
        <p className="text-muted">
          {m.vazioIndice}{' '}
          <Link href="/me/meal-plan" className="font-medium text-brand-ink underline-offset-4 hover:underline">
            {messages.cardapio.titulo}
          </Link>
        </p>
      )}

      {lists.length > 0 && (
        <ul className="flex flex-col gap-2">
          {lists.map((l) => (
            <li
              key={l.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 shadow-sm"
            >
              <ShoppingCart className="size-5 shrink-0 text-brand-ink" strokeWidth={1.5} aria-hidden />
              <Link
                href={`/me/shopping-lists/${l.id}`}
                className="flex min-w-0 flex-1 flex-col hover:text-brand-ink"
              >
                <span className="truncate font-medium text-fg">{l.name}</span>
                <span className="text-xs text-muted">
                  {l.itemCount === 1 ? m.itemContagem : m.itensContagem.replace('{n}', String(l.itemCount))}
                </span>
              </Link>
              <button
                type="button"
                aria-label={m.apagarLista.replace('{nome}', () => l.name)}
                onClick={() => void handleDelete(l)}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-brand/10 hover:text-fg"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
