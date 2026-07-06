'use client'
/**
 * "Lista de compras" (#528, ADR-0032 dec.5) — o cliente que EDITA À MÃO uma Lista: item avulso
 * (nome obrigatório; quantidade/unidade opcionais), editar a quantidade de uma linha, remover uma
 * linha. Espelha a disciplina de `SavedRecipesView` (guard de sessão no client, estados numa live
 * region, mutações via `fetch` contra os route handlers `/api/me/shopping-lists/*`). O servidor é a
 * verdade; a UI é afordância.
 *
 * ESCOPO desta tela (MVP demoável): mostra e edita a lista-PADRÃO do usuário (ADR-0032 dec.1 — "1
 * toque sem nomear"), auto-criando-a no 1º acesso se ainda não existir (via `POST
 * /api/me/shopping-lists`, idempotente contra corrida pela UNIQUE(user_id,name)). Um seletor entre
 * MÚLTIPLAS listas nomeadas (criar/renomear/apagar Lista) fica para a UI de "adicionar de Receita"
 * (fluxo ainda não wireado no app — #526/#527 só têm rota, não tela) — fora do escopo desta issue,
 * que é especificamente a edição das LINHAS.
 *
 * Exibição da linha REUSA `formatIngredientLine` (`@/domain/ingredient-line`) — a MESMA composição
 * de prosa natural do detalhe da Receita (Direção B: nunca re-embute a medida no nome, nunca
 * flexiona o nome por código) — adaptando `ShoppingListItemView` pro shape `IngredientView`
 * (mesmos três campos: quantidade/unidade/nome).
 *
 * ADR-0015: só tokens brand/neutros.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fieldClassName } from '@/components/button'
import { UNIDADES } from '@/domain/vocabulary'
import { DEFAULT_SHOPPING_LIST_NAME } from '@/domain/shopping-list'
import { formatIngredientLine } from '@/domain/ingredient-line'
import { formatQuantityInput, parseQuantityInput } from '@/domain/quantity-format'
import type { Messages } from '@/i18n/messages'

type ListSummary = { id: string; name: string }
type ItemView = {
  id: string
  nome: string
  quantidade: string | null
  unidade: string | null
}
type Status = 'loading' | 'idle' | 'error'
type M = Messages['listaCompras']

export function ShoppingListView() {
  const { locale, messages } = useLocale()
  const m = messages.listaCompras
  const session = useSession()
  const authed = !session.isPending && !session.error && !!session.data
  const pathname = usePathname()
  const returnTo = pathname ?? '/me/shopping-lists'

  const [listId, setListId] = useState<string | null>(null)
  const [items, setItems] = useState<ItemView[]>([])
  const [status, setStatus] = useState<Status>('loading')

  const abortRef = useRef<AbortController | null>(null)

  // Garante a lista-PADRÃO (dec.1): busca as listas do usuário; se nenhuma existe ainda, cria a
  // default (o POST é idempotente contra corrida pela UNIQUE — 409 "já existe" nesse caminho
  // simplesmente recarrega, a lista já está lá). Só roda uma vez, quando autentica.
  useEffect(() => {
    if (!authed) return
    const t = setTimeout(() => {
      void (async () => {
        const res = await fetch('/api/me/shopping-lists')
        if (!res.ok) {
          setStatus('error')
          return
        }
        const body = (await res.json()) as { lists: ListSummary[] }
        if (body.lists.length > 0) {
          setListId(body.lists[0].id)
          return
        }
        const created = await fetch('/api/me/shopping-lists', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: DEFAULT_SHOPPING_LIST_NAME }),
        })
        if (created.ok) {
          const createdBody = (await created.json()) as { list: { id: string } }
          setListId(createdBody.list.id)
          return
        }
        // Corrida perdida (409 nome_duplicado) ou outra falha: refetch pra pegar a que já existe.
        const retry = await fetch('/api/me/shopping-lists')
        if (!retry.ok) {
          setStatus('error')
          return
        }
        const retryBody = (await retry.json()) as { lists: ListSummary[] }
        if (retryBody.lists.length > 0) setListId(retryBody.lists[0].id)
        else setStatus('error')
      })()
    }, 0)
    return () => clearTimeout(t)
  }, [authed])

  const loadItems = useCallback(async (id: string, signal?: AbortSignal) => {
    setStatus('loading')
    try {
      const url = new URL(`/api/me/shopping-lists/${id}/items`, window.location.origin)
      const res = await fetch(url, { signal })
      if (!res.ok) {
        setStatus('error')
        return
      }
      const body = (await res.json()) as { items: ItemView[] }
      setItems(body.items)
      setStatus('idle')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    if (!listId) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    // Deferido (espelha `SavedRecipesView`): setState não pode rodar síncrono no corpo do effect.
    const t = setTimeout(() => {
      void loadItems(listId, controller.signal)
    }, 0)
    return () => {
      clearTimeout(t)
      controller.abort()
    }
  }, [listId, loadItems])

  const refresh = useCallback(() => {
    if (listId) void loadItems(listId)
  }, [listId, loadItems])

  // ── Guards de sessão ─────────────────────────────────────────────────────────
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
    <div className="flex flex-col gap-8">
      {items.length > 0 && (
        <ul role="list" className="flex flex-col gap-3">
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              listId={listId}
              locale={locale}
              messages={messages}
              onChanged={refresh}
            />
          ))}
        </ul>
      )}

      {isEmpty && <p className="text-muted">{m.vazio}</p>}

      {/* Live region: loading/erro. */}
      <div aria-live="polite" className="text-sm text-muted">
        {status === 'loading' && <p>{messages.system.loading}</p>}
        {status === 'error' && (
          <p role="alert" className="font-medium text-fg">
            {m.erroCarregar}
          </p>
        )}
      </div>

      <AdhocItemForm listId={listId} locale={locale} m={m} onAdded={refresh} />
    </div>
  )
}

/** Mapeia o código de erro do servidor pra mensagem localizada; default = genérico. */
function errorMessage(code: string | undefined, m: M): string {
  switch (code) {
    case 'nome_invalido':
      return m.erroNomeInvalido
    case 'quantidade_invalida':
      return m.erroQuantidadeInvalida
    case 'unidade_invalida':
      return m.erroUnidadeInvalida
    default:
      return m.erro
  }
}

/** UMA linha: exibição em prosa (`formatIngredientLine`, Direção B) + editar quantidade + remover. */
function ItemRow({
  item,
  listId,
  locale,
  messages,
  onChanged,
}: {
  item: ItemView
  listId: string | null
  locale: string
  messages: Messages
  onChanged: () => void
}) {
  const m = messages.listaCompras
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)

  // `formatIngredientLine` lê `unidadeLabel`/`unidadeLabelPlural`/`unidadeConector` — chaves de
  // TOPO do catálogo (globais, não do namespace `listaCompras`) — daí o pacote INTEIRO de
  // mensagens, não só `m`. MESMA composição de prosa do detalhe da Receita (reuso, ADR-0012
  // Adendo 2: nunca re-embute a medida no nome, nunca flexiona o nome por código).
  const linha = formatIngredientLine(
    { ordem: 0, quantidade: item.quantidade, unidade: item.unidade, rawText: item.nome },
    messages,
    locale,
  )

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (saving || !listId) return
    setSaving(true)
    setError(null)
    const trimmed = value.trim()
    const quantidade = trimmed === '' ? null : parseQuantityInput(trimmed, locale)
    try {
      const res = await fetch(`/api/me/shopping-lists/${listId}/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quantidade }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(errorMessage(body.error, m))
        return
      }
      setEditing(false)
      onChanged()
    } catch {
      setError(m.erro)
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    if (removing || !listId) return
    if (!window.confirm(m.confirmarRemover)) return
    setRemoving(true)
    try {
      const res = await fetch(`/api/me/shopping-lists/${listId}/items/${item.id}`, { method: 'DELETE' })
      if (res.ok) onChanged()
    } finally {
      setRemoving(false)
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-fg">{linha}</span>
        {!editing && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setValue(formatQuantityInput(item.quantidade, locale))
                setError(null)
                setEditing(true)
              }}
              aria-label={`${m.editarQuantidade}: ${item.nome}`}
            >
              {m.editarQuantidade}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRemove}
              disabled={removing}
              aria-label={`${m.remover}: ${item.nome}`}
            >
              {m.remover}
            </Button>
          </div>
        )}
      </div>

      {editing && (
        <form onSubmit={handleSave} className="flex flex-wrap items-center gap-2">
          <label htmlFor={`qtd-${item.id}`} className="sr-only">
            {m.quantidade}
          </label>
          <Input
            id={`qtd-${item.id}`}
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
            }}
            placeholder={m.quantidadePlaceholder}
            autoFocus
            className="w-28"
          />
          <Button type="submit" variant="secondary" size="sm" disabled={saving}>
            {m.salvar}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(false)
              setError(null)
            }}
          >
            {m.cancelar}
          </Button>
          {error != null && (
            <p role="alert" className="w-full text-sm font-medium text-fg">
              {error}
            </p>
          )}
        </form>
      )}
    </li>
  )
}

/** Formulário de item AVULSO (ADR-0032 dec.5): nome obrigatório, quantidade/unidade opcionais. */
function AdhocItemForm({
  listId,
  locale,
  m,
  onAdded,
}: {
  listId: string | null
  locale: string
  m: M
  onAdded: () => void
}) {
  const [nome, setNome] = useState('')
  const [quantidade, setQuantidade] = useState('')
  const [unidade, setUnidade] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (adding || !listId) return
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
        setError(errorMessage(body.error, m))
        return
      }
      setNome('')
      setQuantidade('')
      setUnidade('')
      onAdded()
    } catch {
      setError(m.erro)
    } finally {
      setAdding(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3 sm:flex-row sm:flex-wrap sm:items-end"
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
        <SelectUnidade value={unidade} onChange={setUnidade} nenhuma={m.unidadeNenhuma} />
      </label>
      <Button type="submit" variant="secondary" disabled={adding || nome.trim() === '' || !listId}>
        {adding ? m.adicionando : m.adicionar}
      </Button>
      {error != null && (
        <p role="alert" className="w-full text-sm font-medium text-fg">
          {error}
        </p>
      )}
    </form>
  )
}

/** Select de unidade — itera `UNIDADES` do domínio (@/domain/vocabulary) + rótulo GLOBAL
 * `messages.unidadeLabel` (não duplica o mapa aqui). Espelha `create-structured-experience.tsx`. */
function SelectUnidade({
  value,
  onChange,
  nenhuma,
}: {
  value: string
  onChange: (v: string) => void
  nenhuma: string
}) {
  const { messages } = useLocale()
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={fieldClassName}>
      <option value="">{nenhuma}</option>
      {UNIDADES.map((u) => (
        <option key={u} value={u}>
          {messages.unidadeLabel[u]}
        </option>
      ))}
    </select>
  )
}
