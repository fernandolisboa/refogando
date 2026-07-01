'use client'
/**
 * "Salvos" (#364) — o cliente que lista os SAVES e as COLEÇÕES do dono. Espelha a disciplina de
 * `MyRecipesList`/`DiscoveryFeed` (guard de sessão no client, estados numa live region, cards FORA
 * dela). Consome os route handlers `/api/me/collections` (lista + CRUD), `/api/me/saved` ("Todos")
 * e `/api/me/collections/[id]/items` (itens da coleção). O servidor é a verdade; a UI é afordância.
 *
 * ADR-0015: só tokens brand/neutros — âmbar (`aviso-*`) é exclusivo do Aviso de restrição, e
 * accent/accent-surface são do selo do Catálogo. Nada disso aqui.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Image as ImageIcon } from 'lucide-react'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { RecipeListItem } from '@/domain/recipe-list-read'
import { recipeDetailPath } from '@/domain/recipe-detail-route'

type Summary = { id: string; name: string; createdAt: string; itemCount: number }
type Selected = 'all' | string // 'all' = "Todos"; senão um collection id
type Status = 'loading' | 'idle' | 'error'

export function SavedRecipesView() {
  const { locale, messages } = useLocale()
  const m = messages.colecoes
  const session = useSession()
  const authed = !session.isPending && !session.error && !!session.data

  const [collections, setCollections] = useState<Summary[]>([])
  const [selected, setSelected] = useState<Selected>('all')
  const [recipes, setRecipes] = useState<RecipeListItem[]>([])
  const [status, setStatus] = useState<Status>('loading')

  // Formulário de nova coleção + erro de criação (nome inválido/duplicado/limite).
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const abortRef = useRef<AbortController | null>(null)

  // Carrega/recarrega as coleções (após mutações). Não depende do `selected`.
  const loadCollections = useCallback(async () => {
    const res = await fetch('/api/me/collections')
    if (!res.ok) return
    const body = (await res.json()) as { collections: Summary[] }
    setCollections(body.collections)
  }, [])

  useEffect(() => {
    if (!authed) return
    // Deferido (espelha MyRecipesList): setState não pode rodar síncrono no corpo do effect.
    const t = setTimeout(() => {
      void loadCollections()
    }, 0)
    return () => clearTimeout(t)
  }, [authed, loadCollections])

  // Carrega a lista de receitas da seleção corrente ("Todos" ou uma coleção). Reexecuta quando
  // `selected`/`locale` mudam; cancela a request anterior. Se a coleção some (404), volta a "Todos".
  useEffect(() => {
    if (!authed) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const url =
      selected === 'all'
        ? new URL('/api/me/saved', window.location.origin)
        : new URL(`/api/me/collections/${selected}/items`, window.location.origin)
    url.searchParams.set('locale', locale)

    const t = setTimeout(() => {
      setRecipes([])
      setStatus('loading')
      void (async () => {
        try {
          const res = await fetch(url, { signal: controller.signal })
          if (res.status === 404) {
            setSelected('all')
            return
          }
          if (!res.ok) {
            setStatus('error')
            return
          }
          const body = (await res.json()) as { recipes: RecipeListItem[] }
          setRecipes(body.recipes)
          setStatus('idle')
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setStatus('error')
        }
      })()
    }, 0)

    return () => {
      clearTimeout(t)
      controller.abort()
    }
  }, [authed, selected, locale])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/me/collections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setCreateError(errorMessage(body.error, m))
        return
      }
      setNewName('')
      await loadCollections()
    } catch {
      setCreateError(m.erro)
    } finally {
      setCreating(false)
    }
  }

  async function handleRename(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`/api/me/collections/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        return { ok: false, error: body.error }
      }
      await loadCollections()
      return { ok: true }
    } catch {
      return { ok: false }
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/me/collections/${id}`, { method: 'DELETE' })
    if (res.ok) {
      if (selected === id) setSelected('all')
      await loadCollections()
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
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-muted">{m.precisaEntrar}</p>
        <Button asChild>
          <Link href="/sign-in">{messages.nav.signIn}</Link>
        </Button>
      </div>
    )
  }

  const isEmpty = status === 'idle' && recipes.length === 0

  return (
    <div className="flex flex-col gap-8">
      {/* Trilha de coleções: "Todos" + cada coleção. `radiogroup` semântico (seleção única). */}
      <nav aria-label={m.colecoes} className="flex flex-col gap-3">
        <div role="radiogroup" aria-label={m.colecoes} className="flex flex-wrap gap-2">
          <SelectorChip
            label={m.todos}
            selected={selected === 'all'}
            onSelect={() => setSelected('all')}
          />
          {collections.map((c) => (
            <SelectorChip
              key={c.id}
              label={c.name}
              count={c.itemCount}
              countLabel={(c.itemCount === 1 ? m.itemContagem : m.itensContagem).replace(
                '{n}',
                String(c.itemCount),
              )}
              selected={selected === c.id}
              onSelect={() => setSelected(c.id)}
            />
          ))}
        </div>

        {/* Criar nova coleção. */}
        <form onSubmit={handleCreate} className="flex flex-wrap items-start gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="nova-colecao" className="sr-only">
              {m.nomeColecao}
            </label>
            <Input
              id="nova-colecao"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value)
                setCreateError(null)
              }}
              placeholder={m.novaColecao}
              maxLength={60}
              className="w-56"
            />
          </div>
          <Button type="submit" variant="secondary" disabled={creating || newName.trim() === ''}>
            {m.criar}
          </Button>
          {createError != null && (
            <p role="alert" className="w-full text-sm font-medium text-fg">
              {createError}
            </p>
          )}
        </form>
      </nav>

      {/* Ações da coleção selecionada (renomear/apagar) — nunca sobre "Todos". */}
      {selected !== 'all' && (
        <CollectionActions
          collection={collections.find((c) => c.id === selected)}
          m={m}
          onRename={handleRename}
          onDelete={handleDelete}
        />
      )}

      {/* Cards — FORA da live region. */}
      {recipes.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {recipes.map((item) => (
            <li key={item.id}>
              <Link
                href={recipeDetailPath(locale, item.slug ?? item.id)}
                className="flex h-full flex-col rounded-xl border border-border bg-surface p-4 shadow-sm motion-safe:transition-shadow motion-safe:duration-150 motion-safe:ease-out hover:shadow-md"
              >
                {item.imageUrl != null ? (
                  <div className="relative mb-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      referrerPolicy="no-referrer"
                      className="aspect-video w-full rounded-lg border border-border object-cover"
                    />
                  </div>
                ) : (
                  <div className="mb-3 flex aspect-video items-center justify-center rounded-lg border border-border bg-brand/[0.07] text-brand/40">
                    <ImageIcon className="size-6" strokeWidth={1.5} aria-hidden />
                  </div>
                )}
                <span className="font-display text-lg font-semibold leading-snug text-fg">
                  {item.name}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Vazio: distingue "Todos" (nada salvo) de coleção vazia. */}
      {isEmpty && (
        <p className="text-muted">{selected === 'all' ? m.vazio : m.vazioColecao}</p>
      )}

      {/* Live region: loading/erro. */}
      <div aria-live="polite" className="text-sm text-muted">
        {status === 'loading' && <p>{messages.system.loading}</p>}
        {status === 'error' && (
          <p role="alert" className="font-medium text-fg">
            {m.erroCarregar}
          </p>
        )}
      </div>
    </div>
  )
}

/** Mapeia o código de erro do servidor pra mensagem localizada; default = genérico. */
function errorMessage(code: string | undefined, m: ReturnType<typeof useLocale>['messages']['colecoes']): string {
  switch (code) {
    case 'nome_invalido':
      return m.erroNomeInvalido
    case 'nome_duplicado':
      return m.erroNomeDuplicado
    case 'limite_colecoes':
      return m.erroLimite
    default:
      return m.erro
  }
}

function SelectorChip({
  label,
  count,
  countLabel,
  selected,
  onSelect,
}: {
  label: string
  count?: number
  countLabel?: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={
        'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 ' +
        (selected
          ? 'border-brand-ink bg-brand/10 text-brand-ink'
          : 'border-border bg-surface text-fg hover:border-brand-ink')
      }
    >
      <span>{label}</span>
      {count != null && (
        <span className="text-xs text-muted" aria-label={countLabel}>
          {count}
        </span>
      )}
    </button>
  )
}

function CollectionActions({
  collection,
  m,
  onRename,
  onDelete,
}: {
  collection: Summary | undefined
  m: ReturnType<typeof useLocale>['messages']['colecoes']
  onRename: (id: string, name: string) => Promise<{ ok: boolean; error?: string }>
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  // Erro do rename (nome inválido/duplicado) — espelha `createError` do formulário de criar.
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)

  if (!collection) return null

  if (editing) {
    return (
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (renaming) return
          setRenaming(true)
          setRenameError(null)
          const res = await onRename(collection.id, value)
          setRenaming(false)
          // Só fecha no sucesso; falha (409/400) mantém o form aberto e mostra o erro.
          if (res.ok) setEditing(false)
          else setRenameError(errorMessage(res.error, m))
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <label htmlFor="renomear-colecao" className="sr-only">
          {m.nomeColecao}
        </label>
        <Input
          id="renomear-colecao"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setRenameError(null)
          }}
          maxLength={60}
          autoFocus
          className="w-56"
        />
        <Button type="submit" variant="secondary" disabled={renaming || value.trim() === ''}>
          {m.salvarNome}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setEditing(false)
            setRenameError(null)
          }}
        >
          {m.cancelar}
        </Button>
        {renameError != null && (
          <p role="alert" className="w-full text-sm font-medium text-fg">
            {renameError}
          </p>
        )}
      </form>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setValue(collection.name)
          setRenameError(null)
          setEditing(true)
        }}
      >
        {m.renomear}
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          if (window.confirm(m.confirmarApagar)) onDelete(collection.id)
        }}
      >
        {m.apagar}
      </Button>
    </div>
  )
}
