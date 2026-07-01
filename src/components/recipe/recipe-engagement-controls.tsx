'use client'

/**
 * Controle de SALVAR do detalhe (#62/#362) — um ÍCONE de bookmark no topo (ao lado do "Voltar",
 * acima da foto), não mais uma seção "Comunidade" com botão de texto. Irmão do `RecipeDetailView`
 * (que continua PURO): a page o renderiza no topo-direito quando a Receita está no POOL público OU
 * quando o DONO gerencia a própria (inclusive a privada — AC6).
 *
 * ESTADO DO VIEWER (salvou?), duas origens (#230, ADR-0020):
 *  - Caminho do DONO (dinâmico, cookie): o server JÁ resolve e passa `initialViewerSaved` ⇒
 *    render direto, sem fetch.
 *  - Caminho PÚBLICO/cacheável: o server lê ANÔNIMO (sem cookie) pra ficar cacheável, então
 *    `initialViewerSaved` chega `undefined`. O componente resolve o estado NO CLIENTE: com sessão
 *    (`useSession`), se logado, busca `GET /api/recipes/[id]/social` e hidrata o save real; se
 *    anônimo, o bookmark vira um link "Entrar para salvar"; enquanto a sessão/fetch pendem, nada
 *    pisca (nem bookmark nem convite).
 *
 * ADR-0010: consome os ROUTE HANDLERS `POST /api/recipes/[id]/{save,unsave}` via `fetch` (NÃO
 * Server Action). O servidor é a verdade — impõe sessão (401) e o gate de salvar (404); isto é
 * AFORDÂNCIA: aplica otimismo no clique, espelha a resposta no sucesso, REVERTE no erro com
 * mensagem neutra única. `/save` e `/unsave` devolvem SÓ `{viewerSaved}`.
 *
 * Cores: só tokens já AA-verificados na #54 (brand/neutros). ÂMBAR (`aviso-*`) é PROIBIDO
 * (ADR-0015: exclusivo do Aviso de restrição) e accent/accent-surface também (reservados a
 * `origin=catalog`, ADR-0015). O bookmark PREENCHE (`fill`) na cor da marca quando salvo.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bookmark, FolderPlus } from 'lucide-react'
import { useSession } from '@/lib/auth-client'
import { useLocale } from '@/i18n/provider'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const ICON_BUTTON =
  'inline-flex size-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-brand/10 hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40'

export function RecipeEngagementControls({
  recipeId,
  initialViewerSaved,
}: {
  recipeId: string
  initialViewerSaved?: boolean
}) {
  const { messages } = useLocale()
  const m = messages.comunidade
  const session = useSession()

  // O server entregou o estado do viewer? SÓ o caminho do DONO (dinâmico, com cookie) o faz; o
  // caminho PÚBLICO/cacheável (ADR-0020) lê anônimo e DEIXA ausente — daí resolvemos no cliente.
  const serverResolved = initialViewerSaved !== undefined

  // Sessão do cliente (espelha RecipeDetailActions): só conta como logado quando RESOLVIDA, sem erro
  // e com dados. Enquanto pende, não decidimos nada (evita flash do convite pra quem está logado).
  const sessionSettled = !session.isPending
  const loggedIn = sessionSettled && !session.error && !!session.data

  const [saved, setSaved] = useState(!!initialViewerSaved)
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState(false)
  // Quando o server NÃO resolveu (caminho público), o estado do viewer chega de um fetch client-side.
  const [clientResolved, setClientResolved] = useState(serverResolved)

  // Caminho público + logado: resolve o save do PRÓPRIO viewer (a página é cacheável e não pode
  // personalizar no server). Anônimo NÃO busca (daria 401 e o convite "Entrar" é o certo).
  useEffect(() => {
    if (serverResolved || !loggedIn) return
    let cancelled = false
    fetch(`/api/recipes/${recipeId}/social`)
      .then(async (res) => {
        if (cancelled) return
        if (res.ok) {
          const body = (await res.json()) as { viewerSaved?: boolean }
          setSaved(!!body.viewerSaved)
        }
        setClientResolved(true)
      })
      .catch(() => {
        if (!cancelled) setClientResolved(true)
      })
    return () => {
      cancelled = true
    }
  }, [recipeId, serverResolved, loggedIn])

  // Três modos: 'interactive' (server resolveu OU logado hidratado), 'anon' (sessão resolvida sem
  // login ⇒ link "Entrar para..."), 'pending' (sessão/fetch pendem ⇒ nada, evita flash).
  const mode: 'interactive' | 'anon' | 'pending' = serverResolved
    ? 'interactive'
    : !sessionSettled
      ? 'pending'
      : !loggedIn
        ? 'anon'
        : clientResolved
          ? 'interactive'
          : 'pending'

  async function handleSave() {
    if (saveBusy) return
    setSaveBusy(true)
    setSaveError(false)

    const prevSaved = saved
    setSaved(!prevSaved)

    try {
      const res = await fetch(
        `/api/recipes/${recipeId}/${prevSaved ? 'unsave' : 'save'}`,
        { method: 'POST' },
      )
      if (!res.ok) {
        setSaved(prevSaved)
        setSaveError(true)
        return
      }
      // /save e /unsave devolvem SÓ `{viewerSaved}` — lê APENAS essa fatia.
      const body = (await res.json()) as { viewerSaved: boolean }
      setSaved(body.viewerSaved)
    } catch {
      setSaved(prevSaved)
      setSaveError(true)
    } finally {
      setSaveBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        {mode === 'pending' ? null : mode === 'anon' ? (
          // Anônimo: o bookmark É o convite — leva ao /sign-in (rótulo acessível = "Entrar para salvar").
          <Link href="/sign-in" aria-label={m.convidaEntrarSalvar} className={ICON_BUTTON}>
            <Bookmark className="size-5" strokeWidth={1.5} aria-hidden />
          </Link>
        ) : (
          <>
            <button
              type="button"
              onClick={handleSave}
              disabled={saveBusy}
              aria-label={saved ? m.salvo : m.salvar}
              aria-pressed={saved}
              aria-busy={saveBusy}
              className={cn(ICON_BUTTON, 'disabled:opacity-70', saved && 'text-brand-ink')}
            >
              <Bookmark
                className="size-5"
                strokeWidth={1.5}
                fill={saved ? 'currentColor' : 'none'}
                aria-hidden
              />
            </button>
            {/* Coleção (#364): só quando SALVA (o server barra add de não-salva). Popover ancorado
                ao bookmark — não uma seção. Fecha ao clicar-fora/Escape (Radix). */}
            {saved && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={messages.colecoes.adicionarAColecao}
                    className={ICON_BUTTON}
                  >
                    <FolderPlus className="size-5" strokeWidth={1.5} aria-hidden />
                  </button>
                </PopoverTrigger>
                <PopoverContent>
                  <CollectionPanel recipeId={recipeId} />
                </PopoverContent>
              </Popover>
            )}
          </>
        )}
      </div>

      {saveError && (
        <p role="alert" className="text-sm font-medium text-fg">
          {m.erroSalvar}
        </p>
      )}
    </div>
  )
}

/**
 * Painel de Coleção do detalhe (#364) — conteúdo do Popover ancorado ao bookmark. Carrega a
 * membership ao MONTAR (o Popover só monta ao abrir). Cada coleção é um checkbox (contains);
 * marcar/desmarcar chama POST/DELETE de `items` com otimismo + revert. Criar coleção inline
 * (POST /api/me/collections) já adiciona a Receita à nova pasta. Renderizado só quando a Receita
 * está SALVA (o server rejeita add de não-salva com 422).
 */
type Membership = { id: string; name: string; contains: boolean }

function CollectionPanel({ recipeId }: { recipeId: string }) {
  const { messages } = useLocale()
  const m = messages.colecoes
  const [items, setItems] = useState<Membership[] | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('loading')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    // `status` já nasce 'loading' (useState); o Popover só monta este painel ao abrir, então o
    // fetch dispara uma vez por abertura. `recipeId` é estável enquanto o painel está montado.
    let cancelled = false
    fetch(`/api/recipes/${recipeId}/collections`)
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) {
          setStatus('error')
          return
        }
        const body = (await res.json()) as { collections: Membership[] }
        setItems(body.collections)
        setStatus('idle')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [recipeId])

  async function toggleMembership(id: string, contains: boolean) {
    // Otimista: alterna já; reverte no erro.
    setItems((prev) => prev?.map((c) => (c.id === id ? { ...c, contains: !contains } : c)) ?? prev)
    try {
      const res = contains
        ? await fetch(`/api/me/collections/${id}/items/${recipeId}`, { method: 'DELETE' })
        : await fetch(`/api/me/collections/${id}/items`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ recipeId }),
          })
      if (!res.ok) {
        setItems((prev) => prev?.map((c) => (c.id === id ? { ...c, contains } : c)) ?? prev)
      }
    } catch {
      setItems((prev) => prev?.map((c) => (c.id === id ? { ...c, contains } : c)) ?? prev)
    }
  }

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
        setCreateError(collectionErrorMessage(body.error, m))
        return
      }
      const body = (await res.json()) as { collection: { id: string; name: string } }
      // Já adiciona a Receita à coleção recém-criada (best-effort).
      await fetch(`/api/me/collections/${body.collection.id}/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipeId }),
      })
      setNewName('')
      setItems((prev) =>
        [...(prev ?? []), { id: body.collection.id, name: body.collection.name, contains: true }].sort(
          (a, b) => a.name.localeCompare(b.name),
        ),
      )
    } catch {
      setCreateError(m.erro)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="font-display text-sm font-semibold text-fg">{m.adicionarAColecao}</p>
      {status === 'loading' && <p className="text-sm text-muted">{messages.system.loading}</p>}
      {status === 'error' && (
        <p role="alert" className="text-sm font-medium text-fg">
          {m.erroCarregar}
        </p>
      )}
      {items != null && items.length > 0 && (
        <ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
          {items.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={c.contains}
                  onChange={() => toggleMembership(c.id, c.contains)}
                  className="size-4 accent-brand"
                />
                <span>{c.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {items != null && items.length === 0 && <p className="text-sm text-muted">{m.semColecoes}</p>}
      <form onSubmit={handleCreate} className="flex flex-col gap-2">
        <label htmlFor={`nova-col-${recipeId}`} className="sr-only">
          {m.nomeColecao}
        </label>
        <Input
          id={`nova-col-${recipeId}`}
          value={newName}
          onChange={(e) => {
            setNewName(e.target.value)
            setCreateError(null)
          }}
          placeholder={m.novaColecao}
          maxLength={60}
        />
        <Button type="submit" variant="secondary" disabled={creating || newName.trim() === ''}>
          {m.criar}
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

/** Código de erro do servidor → mensagem localizada da Coleção; default = genérico. */
function collectionErrorMessage(
  code: string | undefined,
  m: ReturnType<typeof useLocale>['messages']['colecoes'],
): string {
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
