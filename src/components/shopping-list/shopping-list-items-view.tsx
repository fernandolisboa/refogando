'use client'
/**
 * Vista de UMA Lista de compras — check-off PERSISTENTE (issue #529, ADR-0032 dec.6) + EDIÇÃO À MÃO
 * (issue #528, dec.5: item avulso + editar quantidade + remover linha). Espelha a disciplina de
 * `SavedRecipesView` (guard de sessão no client, estados numa live region). Consome
 * `GET/DELETE /api/me/shopping-lists/[listId]/items` (ver itens + limpar lista), `POST .../items`
 * `{nome,quantidade?,unidade?}` (item avulso), `DELETE .../items/checked` (remover marcados) e
 * `PATCH .../items/[itemId]` (marca/desmarca via `{checked}` OU edita quantidade via `{quantidade}`)
 * + `DELETE .../items/[itemId]` (remover linha). O servidor é a verdade; a UI é afordância —
 * `checked_at` PERSISTE (nada expira sozinho, dec.6).
 *
 * Reusa `formatIngredientLine` (mesma prosa do detalhe da Receita) pra exibir quantidade+unidade —
 * não reimplementa a composição de medida (ADR-0012 Adendo 2: fonte única, nunca converte unidade;
 * Direção B: nunca re-embute a medida no nome, nunca flexiona o nome por código). O item avulso
 * agrega por nome com os demais no servidor (mesma chave da A2 — `computeMatchKey`).
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { fieldClassName } from '@/components/button'
import { UNIDADES } from '@/domain/vocabulary'
import { formatIngredientLine } from '@/domain/ingredient-line'
import { formatQuantityInput, parseQuantityInput } from '@/domain/quantity-format'
import type { Messages } from '@/i18n/messages'

type ItemView = {
  id: string
  nome: string
  quantidade: string | null
  unidade: string | null
  checkedAt: string | null
}
type ItemsResponse = { list: { id: string; name: string }; items: ItemView[] }
type Status = 'loading' | 'idle' | 'error'
type M = Messages['listaDeCompras']

/** Mapeia o código de erro do servidor pra mensagem localizada; default = genérico. */
function itemErrorMessage(code: string | undefined, m: M): string {
  switch (code) {
    case 'nome_invalido':
      return m.erroItemNomeInvalido
    case 'quantidade_invalida':
      return m.erroQuantidadeInvalida
    case 'unidade_invalida':
      return m.erroUnidadeInvalida
    default:
      return m.erro
  }
}

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

  // Edição de quantidade por linha (só UMA aberta por vez): id + valor + erro.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [editSaving, setEditSaving] = useState(false)

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

  // ── Edição à mão (fatia C, #528) ───────────────────────────────────────────────
  function startEdit(item: ItemView) {
    setEditingId(item.id)
    setEditValue(formatQuantityInput(item.quantidade, locale))
    setEditError(null)
  }

  async function handleSaveEdit(itemId: string) {
    if (editSaving) return
    setEditSaving(true)
    setEditError(null)
    const trimmed = editValue.trim()
    const quantidade = trimmed === '' ? null : parseQuantityInput(trimmed, locale)
    try {
      const res = await fetch(`/api/me/shopping-lists/${listId}/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quantidade }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setEditError(itemErrorMessage(body.error, m))
        return
      }
      setEditingId(null)
      await load()
    } catch {
      setEditError(m.erro)
    } finally {
      setEditSaving(false)
    }
  }

  async function handleRemoveItem(itemId: string) {
    if (!window.confirm(m.confirmarRemover)) return
    setPendingIds((prev) => new Set(prev).add(itemId))
    try {
      const res = await fetch(`/api/me/shopping-lists/${listId}/items/${itemId}`, { method: 'DELETE' })
      if (res.ok) await load()
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(itemId)
        return next
      })
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
            const editing = editingId === item.id
            return (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Checkbox
                    checked={checked}
                    disabled={pendingIds.has(item.id)}
                    aria-label={(checked ? m.itemDesmarcarAria : m.itemMarcarAria).replace('{nome}', item.nome)}
                    onCheckedChange={(next) => void handleToggle(item.id, next === true)}
                  />
                  <span className={`flex-1 ${checked ? 'text-muted line-through' : 'text-fg'}`}>{linha}</span>
                  {!editing && (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => startEdit(item)}
                        aria-label={`${m.editarQuantidade}: ${item.nome}`}
                      >
                        {m.editarQuantidade}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleRemoveItem(item.id)}
                        disabled={pendingIds.has(item.id)}
                        aria-label={`${m.remover}: ${item.nome}`}
                      >
                        {m.remover}
                      </Button>
                    </div>
                  )}
                </div>

                {editing && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      void handleSaveEdit(item.id)
                    }}
                    className="flex flex-wrap items-center gap-2 pl-8"
                  >
                    <label htmlFor={`qtd-${item.id}`} className="sr-only">
                      {m.quantidade}
                    </label>
                    <Input
                      id={`qtd-${item.id}`}
                      type="text"
                      inputMode="decimal"
                      value={editValue}
                      onChange={(e) => {
                        setEditValue(e.target.value)
                        setEditError(null)
                      }}
                      placeholder={m.quantidadePlaceholder}
                      autoFocus
                      className="w-28"
                    />
                    <Button type="submit" variant="secondary" size="sm" disabled={editSaving}>
                      {m.salvar}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingId(null)
                        setEditError(null)
                      }}
                    >
                      {m.cancelar}
                    </Button>
                    {editError != null && (
                      <p role="alert" className="w-full text-sm font-medium text-fg">
                        {editError}
                      </p>
                    )}
                  </form>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* Item avulso (fatia C, #528, dec.5): nome obrigatório, quantidade/unidade opcionais. */}
      <AdhocItemForm listId={listId} locale={locale} m={m} onAdded={load} />
    </div>
  )
}

/** Formulário de item AVULSO — POST /items `{nome, quantidade?, unidade?}` (agrega por nome no
 * servidor, mesma chave da A2). Espelha o layout de campos de `create-structured-experience`. */
function AdhocItemForm({
  listId,
  locale,
  m,
  onAdded,
}: {
  listId: string
  locale: string
  m: M
  onAdded: () => Promise<void>
}) {
  const { messages } = useLocale()
  const [nome, setNome] = useState('')
  const [quantidade, setQuantidade] = useState('')
  const [unidade, setUnidade] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (adding) return
    setAdding(true)
    setError(null)
    const trimmedQtd = quantidade.trim()
    try {
      const res = await fetch(`/api/me/shopping-lists/${listId}/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nome,
          quantidade: trimmedQtd === '' ? null : parseQuantityInput(trimmedQtd, locale),
          unidade: unidade === '' ? null : unidade,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(itemErrorMessage(body.error, m))
        return
      }
      setNome('')
      setQuantidade('')
      setUnidade('')
      await onAdded()
    } catch {
      setError(m.erro)
    } finally {
      setAdding(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium text-fg">
        {m.nomeItem}
        <Input
          type="text"
          value={nome}
          onChange={(e) => {
            setNome(e.target.value)
            setError(null)
          }}
          placeholder={m.nomeItemPlaceholder}
          maxLength={200}
        />
      </label>
      <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:w-28">
        {m.quantidade}
        <Input
          type="text"
          inputMode="decimal"
          value={quantidade}
          onChange={(e) => {
            setQuantidade(e.target.value)
            setError(null)
          }}
          placeholder={m.quantidadePlaceholder}
        />
      </label>
      <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:w-40">
        {m.unidade}
        <select
          value={unidade}
          onChange={(e) => setUnidade(e.target.value)}
          className={fieldClassName}
        >
          <option value="">{m.unidadeNenhuma}</option>
          {UNIDADES.map((u) => (
            <option key={u} value={u}>
              {messages.unidadeLabel[u]}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="secondary" disabled={adding || nome.trim() === ''}>
        {adding ? m.adicionando : m.adicionarBotao}
      </Button>
      {error != null && (
        <p role="alert" className="w-full text-sm font-medium text-fg">
          {error}
        </p>
      )}
    </form>
  )
}
