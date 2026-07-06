'use client'
/**
 * Vista de UMA Lista de compras — check-off PERSISTENTE (issue #529, ADR-0032 dec.6). Espelha a
 * disciplina de `SavedRecipesView` (guard de sessão no client, estados numa live region). Consome
 * `GET/DELETE /api/me/shopping-lists/[listId]/items` (ver itens + limpar lista),
 * `DELETE .../items/checked` (remover marcados) e `PATCH .../items/[itemId]` (marcar/desmarcar).
 * O servidor é a verdade; a UI é afordância — `checked_at` PERSISTE (nada expira sozinho, dec.6),
 * então marcar/recarregar/remarcar refletem sempre o estado gravado no banco.
 *
 * Reusa `formatIngredientLine` (mesma prosa do detalhe da Receita) pra exibir quantidade+unidade —
 * não reimplementa a composição de medida (ADR-0012 Adendo 2: fonte única, nunca converte unidade).
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { formatIngredientLine } from '@/domain/ingredient-line'

type ItemView = {
  id: string
  nome: string
  quantidade: string | null
  unidade: string | null
  checkedAt: string | null
}
type ItemsResponse = { list: { id: string; name: string }; items: ItemView[] }
type Status = 'loading' | 'idle' | 'error'

export function ShoppingListItemsView({ listId }: { listId: string }) {
  const { locale, messages } = useLocale()
  const m = messages.listaDeCompras
  const session = useSession()
  const authed = !session.isPending && !session.error && !!session.data
  const pathname = usePathname()
  const returnTo = pathname ?? `/me/shopping-lists/${listId}`

  const [listName, setListName] = useState<string | null>(null)
  const [items, setItems] = useState<ItemView[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [bulkPending, setBulkPending] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/me/shopping-lists/${listId}/items`)
    if (!res.ok) {
      setStatus('error')
      return
    }
    const body = (await res.json()) as ItemsResponse
    setListName(body.list.name)
    setItems(body.items)
    setStatus('idle')
  }, [listId])

  useEffect(() => {
    if (!authed) return
    // Deferido (espelha SavedRecipesView): setState não pode rodar síncrono no corpo do effect.
    const t = setTimeout(() => {
      void load()
    }, 0)
    return () => clearTimeout(t)
  }, [authed, load])

  async function handleToggle(itemId: string, checked: boolean) {
    setPendingIds((prev) => new Set(prev).add(itemId))
    // Otimista: reflete na hora, reconcilia com o servidor (a verdade) ao final.
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, checkedAt: checked ? new Date().toISOString() : null } : i)))
    try {
      const res = await fetch(`/api/me/shopping-lists/${listId}/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ checked }),
      })
      if (!res.ok) {
        await load() // reconcilia com o estado real do servidor em caso de erro.
        return
      }
      const body = (await res.json()) as { checkedAt: string | null }
      setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, checkedAt: body.checkedAt } : i)))
    } catch {
      await load()
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(itemId)
        return next
      })
    }
  }

  async function handleRemoveChecked() {
    if (bulkPending) return
    if (!window.confirm(m.confirmarRemoverMarcados)) return
    setBulkPending(true)
    try {
      const res = await fetch(`/api/me/shopping-lists/${listId}/items/checked`, { method: 'DELETE' })
      if (res.ok) await load()
    } finally {
      setBulkPending(false)
    }
  }

  async function handleClearList() {
    if (bulkPending) return
    if (!window.confirm(m.confirmarLimparLista)) return
    setBulkPending(true)
    try {
      const res = await fetch(`/api/me/shopping-lists/${listId}/items`, { method: 'DELETE' })
      if (res.ok) await load()
    } finally {
      setBulkPending(false)
    }
  }

  // ── Guards de sessão ─────────────────────────────────────────────────────────
  // Sessão pendente → loading. Resolvida SEM autenticação → convite de entrar (ANTES de olhar
  // `status`: o guest nunca dispara o fetch de itens — ver o useEffect acima — então `status`
  // fica preso em 'loading' pra sempre nesse caso; checar `authed` primeiro evita um loading
  // eterno pro guest).
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
        <p className="text-muted">{m.erro}</p>
        <Button variant="secondary" onClick={() => void load()}>
          {messages.system.retry}
        </Button>
      </div>
    )
  }

  const hasChecked = items.some((i) => i.checkedAt != null)

  return (
    <div className="flex flex-col gap-6">
      {listName != null && (
        <h2 className="font-display text-xl font-semibold tracking-tight text-fg">{listName}</h2>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => void handleRemoveChecked()}
          disabled={!hasChecked || bulkPending}
        >
          {m.removerMarcados}
        </Button>
        <Button
          variant="destructive"
          onClick={() => void handleClearList()}
          disabled={items.length === 0 || bulkPending}
        >
          {m.limparLista}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-muted">{m.vazia}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const checked = item.checkedAt != null
            const linha = formatIngredientLine(
              { ordem: 0, quantidade: item.quantidade, unidade: item.unidade, rawText: item.nome },
              messages,
              locale,
            )
            return (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3"
              >
                <Checkbox
                  checked={checked}
                  disabled={pendingIds.has(item.id)}
                  aria-label={(checked ? m.itemDesmarcarAria : m.itemMarcarAria).replace('{nome}', item.nome)}
                  onCheckedChange={(next) => void handleToggle(item.id, next === true)}
                />
                <span className={checked ? 'text-muted line-through' : 'text-fg'}>{linha}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
