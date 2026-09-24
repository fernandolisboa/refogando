'use client'

/**
 * Botão "Adicionar à lista de compras" do detalhe (fatia B, issue #527, ADR-0032 dec.3/7) — ícone
 * no topo, ao lado do bookmark de Salvar (`RecipeEngagementControls`), MESMO padrão visual: ícone +
 * Popover ancorado, otimista onde faz sentido. Sem modal cheio de tela.
 *
 * PORÇÕES-ALVO (dec.3): NÃO tem campo numérico próprio — reusa o MESMO valor corrente do escalador
 * de porções da página (`usePortionScale`, #452/#453), que já vive no `PortionScaleProvider`
 * ancestral comum (montado em `DetailChrome`, envolvendo esta árvore). O usuário ajusta "Porções"
 * com o controle `− N +` já existente e o que ele VÊ na tela é o que entra na lista (WYSIWYG) — evita
 * duplicar a afordância de porções em dois lugares da mesma página. Só manda `porcoesAlvo` quando a
 * Receita DECLARA `porcoes` (`porcoesReceita != null`); sem isso o escalador nem monta na página, e
 * mandar um valor arbitrário (o default 1 do contexto ocioso) dispararia o aviso `sem_porcoes` sem
 * o usuário ter pedido nada — então o caminho BASE fica silencioso, como antes do #527.
 *
 * Cada Lista existente vira uma linha com um botão "Adicionar"; criar lista nova (inline) já
 * adiciona a Receita na lista recém-criada — espelha `CollectionPanel` (criar já salva).
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ShoppingCart } from 'lucide-react'
import { useSession } from '@/lib/auth-client'
import { useLocale } from '@/i18n/provider'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { usePortionScale } from './recipe-portion-scale-context'

const ICON_BUTTON =
  'inline-flex size-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-brand/10 hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40'

export function RecipeShoppingListButton({
  recipeId,
  porcoesReceita,
}: {
  recipeId: string
  porcoesReceita: number | null
}) {
  const { messages } = useLocale()
  const m = messages.listaDeCompras
  const session = useSession()
  const pathname = usePathname()
  const returnTo = pathname ?? '/'
  const { porcoes } = usePortionScale()

  const [open, setOpen] = useState(false)

  const sessionSettled = !session.isPending
  const loggedIn = sessionSettled && !session.error && !!session.data

  if (!sessionSettled) return null

  if (!loggedIn) {
    return (
      <Link
        href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
        aria-label={m.convidaEntrarAdicionar}
        className={ICON_BUTTON}
      >
        <ShoppingCart className="size-5" strokeWidth={1.5} aria-hidden />
      </Link>
    )
  }

  // Porções-alvo só faz sentido quando a Receita declara `porcoes` (o escalador da página só monta
  // nesse caso) — sem isso, o add segue BASE, sem mandar um valor arbitrário.
  const porcoesAlvo = porcoesReceita != null ? porcoes : null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={m.adicionar}
          className={cn(ICON_BUTTON)}
        >
          <ShoppingCart className="size-5" strokeWidth={1.5} aria-hidden />
        </button>
      </PopoverAnchor>
      <PopoverContent>
        <ShoppingListPanel recipeId={recipeId} porcoesAlvo={porcoesAlvo} />
      </PopoverContent>
    </Popover>
  )
}

type ListSummary = { id: string; name: string }
type RowStatus = 'idle' | 'busy' | 'ok' | 'warning' | 'error'

function ShoppingListPanel({
  recipeId,
  porcoesAlvo,
}: {
  recipeId: string
  porcoesAlvo: number | null
}) {
  const { messages } = useLocale()
  const m = messages.listaDeCompras
  const [lists, setLists] = useState<ListSummary[] | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('loading')
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({})
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/me/shopping-lists')
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) {
          setStatus('error')
          return
        }
        const body = (await res.json()) as { lists: ListSummary[] }
        setLists(body.lists.map((l) => ({ id: l.id, name: l.name })))
        setStatus('idle')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function addTo(listId: string) {
    setRowStatus((prev) => ({ ...prev, [listId]: 'busy' }))
    try {
      const res = await fetch(`/api/me/shopping-lists/${listId}/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          recipeId,
          ...(porcoesAlvo != null ? { porcoesAlvo } : {}),
        }),
      })
      if (!res.ok) {
        setRowStatus((prev) => ({ ...prev, [listId]: 'error' }))
        return
      }
      const body = (await res.json()) as { ok: boolean; warning?: string }
      setRowStatus((prev) => ({ ...prev, [listId]: body.warning === 'sem_porcoes' ? 'warning' : 'ok' }))
    } catch {
      setRowStatus((prev) => ({ ...prev, [listId]: 'error' }))
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/me/shopping-lists', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setCreateError(shoppingListErrorMessage(body.error, m))
        return
      }
      const body = (await res.json()) as { list: { id: string; name: string } }
      setLists((prev) =>
        [...(prev ?? []), { id: body.list.id, name: body.list.name }].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      )
      setNewName('')
      await addTo(body.list.id)
    } catch {
      setCreateError(m.erro)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="font-display text-sm font-semibold text-fg">{m.adicionarALista}</p>
      {status === 'loading' && <p className="text-sm text-muted">{messages.system.loading}</p>}
      {status === 'error' && (
        <p role="alert" className="text-sm font-medium text-fg">
          {m.erroCarregarListas}
        </p>
      )}
      {lists != null && lists.length > 0 && (
        <ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
          {lists.map((l) => {
            const rs = rowStatus[l.id] ?? 'idle'
            return (
              <li key={l.id} className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between gap-2 text-sm text-fg">
                  <span>{l.name}</span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={rs === 'busy'}
                    onClick={() => addTo(l.id)}
                  >
                    {rs === 'ok' || rs === 'warning' ? m.adicionado : m.adicionarBotao}
                  </Button>
                </div>
                {rs === 'warning' && <p className="text-xs text-muted">{m.avisoSemPorcoes}</p>}
                {rs === 'error' && (
                  <p role="alert" className="text-xs font-medium text-fg">
                    {m.erro}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {lists != null && lists.length === 0 && <p className="text-sm text-muted">{m.semListas}</p>}
      <form onSubmit={handleCreate} className="flex flex-col gap-2">
        <label htmlFor={`nova-lista-${recipeId}`} className="sr-only">
          {m.nomeNovaLista}
        </label>
        <Input
          id={`nova-lista-${recipeId}`}
          value={newName}
          onChange={(e) => {
            setNewName(e.target.value)
            setCreateError(null)
          }}
          placeholder={m.nomeNovaLista}
          maxLength={60}
        />
        <Button type="submit" variant="secondary" disabled={creating || newName.trim() === ''}>
          {m.criarEAdicionar}
        </Button>
      </form>
      {createError != null && (
        <p role="alert" className="text-sm font-medium text-fg">
          {createError}
        </p>
      )}
    </div>
  )
}

/** Código de erro do servidor → mensagem localizada da Lista de compras; default = genérico. */
function shoppingListErrorMessage(
  code: string | undefined,
  m: ReturnType<typeof useLocale>['messages']['listaDeCompras'],
): string {
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
