'use client'

/**
 * Controles de Engajamento da Comunidade (#62/#362) — bloco de SALVAR na tela de detalhe.
 * Irmão do `RecipeDetailView` (que continua PURO, sem hooks): a page renderiza isto quando a
 * Receita está no POOL público OU quando o DONO gerencia a própria (inclusive a privada — AC6).
 *
 * ESTADO DO VIEWER (salvou?), duas origens (#230, ADR-0020):
 *  - Caminho do DONO (dinâmico, cookie): o server JÁ resolve e passa `initialViewerSaved` ⇒
 *    render direto, sem fetch.
 *  - Caminho PÚBLICO/cacheável: o server lê ANÔNIMO (sem cookie) pra ficar cacheável, então
 *    `initialViewerSaved` chega `undefined`. Aqui é que o flash de "Entrar para salvar" pra quem
 *    ESTÁ logado morava: o componente precisa resolver o estado NO CLIENTE. Com sessão
 *    (`useSession`), se logado, busca `GET /api/recipes/[id]/social` e hidrata o save real; se
 *    anônimo, mostra o convite "Entrar para..."; enquanto a sessão/fetch pendem, não pisca nem
 *    botão nem convite.
 *
 * ADR-0010: consome os ROUTE HANDLERS `POST /api/recipes/[id]/{save,unsave}` via `fetch` (NÃO
 * Server Action). O servidor é a verdade — impõe sessão (401) e o gate de salvar (404); isto é
 * AFORDÂNCIA: aplica otimismo no clique, espelha a resposta no sucesso, REVERTE no erro com
 * mensagem neutra única (não diferencia 401/404 pro usuário). `/save` e `/unsave` devolvem SÓ
 * `{viewerSaved}` — o handler lê apenas essa fatia.
 *
 * Cores: só tokens já AA-verificados na #54 (brand/neutros). ÂMBAR (`aviso-*`) é PROIBIDO
 * (ADR-0015: exclusivo do Aviso de restrição) e accent/accent-surface também (reservados a
 * `origin=catalog`, ADR-0015).
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from '@/lib/auth-client'
import { useLocale } from '@/i18n/provider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
  // `clientResolved` parte de `serverResolved`: já resolvido no caminho do dono (nada a buscar). No
  // caminho público vira true quando o GET /social responde (ou falha — degradação graciosa).
  const [clientResolved, setClientResolved] = useState(serverResolved)

  // Caminho público + logado: resolve o save do PRÓPRIO viewer (a página é cacheável e não pode
  // personalizar no server). Anônimo NÃO busca (daria 401 e o convite "Entrar" é o certo). O fetch
  // dispara quando a sessão vira logada; falha ⇒ resolve com o default (não-salvo), pra não travar
  // logado no convite nem quebrar — o server corrige no clique.
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

  // Três estados de renderização do bloco de ação:
  //  - 'interactive': server resolveu (caminho do dono) OU já hidratamos o logado (caminho público).
  //  - 'anon': sessão resolvida e SEM login ⇒ convite "Entrar para...".
  //  - 'pending': sessão ainda pende OU logado mas o GET /social ainda não voltou ⇒ sem botões nem
  //    convite, evitando o flash de "Entrar" pra quem está logado.
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
      // Sem `router.refresh()`: o corpo do POST é autoritativo e nada na page deriva do save,
      // então o round-trip full-page seria descartado (os props frescos só alimentam
      // inicializadores de `useState`, que não re-rodam sem remontar).
    } catch {
      setSaved(prevSaved)
      setSaveError(true)
    } finally {
      setSaveBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="engajamento-titulo"
      className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3"
    >
      <h2 id="engajamento-titulo" className="font-display text-lg font-semibold text-fg">
        {m.titulo}
      </h2>

      <div className="flex flex-wrap items-center gap-3">
        {mode === 'pending' ? null : mode === 'anon' ? (
          <Button asChild variant="secondary">
            <Link href="/sign-in">{m.convidaEntrarSalvar}</Link>
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleSave}
            disabled={saveBusy}
            aria-pressed={saved}
            aria-busy={saveBusy}
            variant={saved ? 'default' : 'secondary'}
            className="disabled:opacity-70"
          >
            {saved ? m.salvo : m.salvar}
          </Button>
        )}
      </div>

      {/* Picker de Coleção (#364): só quando a Receita está SALVA (o server barra add de não-salva).
          Some ao dessalvar. Reusa /api/recipes/[id]/collections + /api/me/collections/[id]/items. */}
      {mode === 'interactive' && saved && <CollectionPicker recipeId={recipeId} />}

      {saveError && (
        <Alert variant="info" role="alert">
          <AlertDescription className="font-medium text-foreground">
            {m.erroSalvar}
          </AlertDescription>
        </Alert>
      )}
    </section>
  )
}

/**
 * Picker de Coleção do detalhe (#364) — disclosure lazy: só busca a membership ao abrir. Cada
 * coleção é um checkbox (contains); marcar/desmarcar chama POST/DELETE de `items` com otimismo +
 * revert. Criar coleção inline (POST /api/me/collections) já adiciona a Receita à nova pasta.
 * Renderizado só quando a Receita está SALVA (o server rejeita add de não-salva com 422).
 */
type Membership = { id: string; name: string; contains: boolean }

function CollectionPicker({ recipeId }: { recipeId: string }) {
  const { messages } = useLocale()
  const m = messages.colecoes
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Membership[] | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  async function load() {
    setStatus('loading')
    try {
      const res = await fetch(`/api/recipes/${recipeId}/collections`)
      if (!res.ok) {
        setStatus('error')
        return
      }
      const body = (await res.json()) as { collections: Membership[] }
      setItems(body.collections)
      setStatus('idle')
    } catch {
      setStatus('error')
    }
  }

  function toggleOpen() {
    const next = !open
    setOpen(next)
    if (next && items === null) void load()
  }

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
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="secondary"
        aria-expanded={open}
        onClick={toggleOpen}
        className="self-start"
      >
        {m.adicionarAColecao}
      </Button>
      {open && (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-bg p-3">
          {status === 'loading' && <p className="text-sm text-muted">{messages.system.loading}</p>}
          {status === 'error' && (
            <p role="alert" className="text-sm font-medium text-fg">
              {m.erroCarregar}
            </p>
          )}
          {items != null && items.length > 0 && (
            <ul className="flex flex-col gap-1.5">
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
          {items != null && items.length === 0 && (
            <p className="text-sm text-muted">{m.semColecoes}</p>
          )}
          <form onSubmit={handleCreate} className="flex flex-wrap items-center gap-2">
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
              className="w-48"
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
