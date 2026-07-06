'use client'
/**
 * Barra de "Adicionar à lista" — multi-seleção (fatia E, issue #530, ADR-0032 dec.7). Aparece
 * quando 1..N Receitas estão selecionadas (ver `SavedRecipesView`); escolhe uma Lista de compras
 * EXISTENTE ou cria uma nova inline, então dispara UM POST em lote
 * (`/api/me/shopping-lists/[listId]/items/batch`) que reusa o merge/agregação da A2 por Receita
 * (ADR-0032 dec.2/4). SEM seletor de porções — dec.7 é explícita: o lote sempre entra na
 * quantidade BASE, o escalonamento fica no fluxo de UMA Receita (fatia B).
 *
 * `<select>` NATIVO (não o `Select` do Radix): a interação é só escolher um id numa lista curta —
 * o nativo é testável direto com `fireEvent.change`, sem a complexidade de portal/pointer-capture
 * do Radix. Espelha o estilo de campo do `Input` (mesmas classes de borda/fundo).
 */
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLocale } from '@/i18n/provider'
import type { Messages } from '@/i18n/messages'

type ListOption = { id: string; name: string }
type Status = 'loading' | 'idle' | 'error'

/** Sentinela pro item "+ Nova lista" no `<select>` — nunca colide com um uuid real. */
const NEW_LIST_VALUE = '__nova_lista__'

export function ShoppingListAddBar({
  recipeIds,
  onDone,
}: {
  recipeIds: string[]
  onDone: (result: { addedCount: number; skippedCount: number }) => void
}) {
  const { messages } = useLocale()
  const m = messages.listaDeCompras

  const [lists, setLists] = useState<ListOption[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [selectedListId, setSelectedListId] = useState<string>(NEW_LIST_VALUE)
  const [newListName, setNewListName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Carrega as Listas do usuário ao montar (a barra só existe enquanto há seleção — ver
  // `SavedRecipesView`). Escolhe a primeira lista existente por padrão; sem nenhuma, cai em
  // "+ Nova lista" (o usuário digita o nome e a barra cria antes de adicionar).
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
        setLists(body.lists)
        setSelectedListId(body.lists[0]?.id ?? NEW_LIST_VALUE)
        setStatus('idle')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting || recipeIds.length === 0) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      let listId = selectedListId
      if (listId === NEW_LIST_VALUE) {
        const created = await fetch('/api/me/shopping-lists', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: newListName }),
        })
        if (!created.ok) {
          const errBody = (await created.json().catch(() => ({}))) as { error?: string }
          setSubmitError(errorMessage(errBody.error, m))
          return
        }
        const createdBody = (await created.json()) as { list: { id: string } }
        listId = createdBody.list.id
      }

      const res = await fetch(`/api/me/shopping-lists/${listId}/items/batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipeIds }),
      })
      if (!res.ok) {
        setSubmitError(m.erroAdicionar)
        return
      }
      const body = (await res.json()) as { addedCount: number; skippedCount: number }
      onDone({ addedCount: body.addedCount, skippedCount: body.skippedCount })
    } catch {
      setSubmitError(m.erroAdicionar)
    } finally {
      setSubmitting(false)
    }
  }

  if (status === 'loading') {
    return (
      <p aria-busy="true" className="text-sm text-muted">
        {messages.system.loading}
      </p>
    )
  }
  if (status === 'error') {
    return (
      <p role="alert" className="text-sm font-medium text-fg">
        {m.erroCarregarListas}
      </p>
    )
  }

  const criandoNova = selectedListId === NEW_LIST_VALUE

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <label htmlFor="lista-de-compras-alvo" className="sr-only">
        {m.escolherLista}
      </label>
      <select
        id="lista-de-compras-alvo"
        value={selectedListId}
        onChange={(e) => setSelectedListId(e.target.value)}
        className="flex h-9 w-full max-w-56 min-w-0 rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm"
      >
        {lists.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
        <option value={NEW_LIST_VALUE}>{m.novaLista}</option>
      </select>

      {criandoNova && (
        <>
          <label htmlFor="lista-de-compras-novo-nome" className="sr-only">
            {m.nomeNovaLista}
          </label>
          <Input
            id="lista-de-compras-novo-nome"
            value={newListName}
            onChange={(e) => {
              setNewListName(e.target.value)
              setSubmitError(null)
            }}
            placeholder={m.nomeNovaLista}
            maxLength={60}
            className="w-56"
          />
        </>
      )}

      <Button type="submit" disabled={submitting || (criandoNova && newListName.trim() === '')}>
        {submitting ? m.adicionando : m.confirmarAdicionar}
      </Button>

      {submitError != null && (
        <p role="alert" className="w-full text-sm font-medium text-fg">
          {submitError}
        </p>
      )}
    </form>
  )
}

/** Mapeia o código de erro do servidor (criar lista inline) pra mensagem localizada. */
function errorMessage(code: string | undefined, m: Messages['listaDeCompras']): string {
  switch (code) {
    case 'nome_invalido':
      return m.erroNomeInvalido
    case 'nome_duplicado':
      return m.erroNomeDuplicado
    case 'limite_listas':
      return m.erroLimiteListas
    default:
      return m.erro
  }
}
