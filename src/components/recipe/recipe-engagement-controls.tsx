'use client'

/**
 * Controle de SALVAR do detalhe (#62/#362) — um ÍCONE de bookmark no topo (ao lado do "Voltar",
 * acima da foto), não mais uma seção "Comunidade" com botão de texto. Estilo Instagram: o CLIQUE
 * salva (e o bookmark PREENCHE na cor da marca) e, no hover (com atraso) OU no próprio clique/teclado,
 * abre um POPOVER de Coleções ancorado no bookmark — sem um segundo ícone.
 *
 * ESTADO DO VIEWER (salvou?), duas origens (#230, ADR-0020):
 *  - Caminho do DONO (dinâmico, cookie): o server JÁ resolve e passa `initialViewerSaved` ⇒ render
 *    direto, sem fetch.
 *  - Caminho PÚBLICO/cacheável: o server lê ANÔNIMO (sem cookie), então `initialViewerSaved` chega
 *    `undefined` — o componente resolve no cliente: logado, busca `GET /api/recipes/[id]/social`;
 *    anônimo, o bookmark vira um link "Entrar para salvar"; enquanto pende, nada pisca.
 *
 * ADR-0010: consome os ROUTE HANDLERS `POST /api/recipes/[id]/{save,unsave}` via `fetch`. O servidor
 * é a verdade (401/404); isto é AFORDÂNCIA (otimismo no clique, espelha no sucesso, REVERTE no erro).
 *
 * Cores: só tokens AA (#54) brand/neutros. ÂMBAR (`aviso-*`) e accent/accent-surface PROIBIDOS
 * (ADR-0015). O bookmark PREENCHE (`fill`) na cor da marca quando salvo.
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bookmark } from 'lucide-react'
import { useSession } from '@/lib/auth-client'
import { useLocale } from '@/i18n/provider'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
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

  const sessionSettled = !session.isPending
  const loggedIn = sessionSettled && !session.error && !!session.data

  const [saved, setSaved] = useState(!!initialViewerSaved)
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [clientResolved, setClientResolved] = useState(serverResolved)

  // Caminho público + logado: resolve o save do PRÓPRIO viewer (página cacheável). Anônimo NÃO busca.
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

  const mode: 'interactive' | 'anon' | 'pending' = serverResolved
    ? 'interactive'
    : !sessionSettled
      ? 'pending'
      : !loggedIn
        ? 'anon'
        : clientResolved
          ? 'interactive'
          : 'pending'

  // Popover de Coleção: abre no hover (com intenção — atraso ~240ms) OU no clique/teclado; fecha com
  // uma folga (140ms) pra o mouse conseguir viajar do bookmark até o painel sem sumir. Escape e
  // clique-fora fecham (Radix, via `onOpenChange`).
  const [open, setOpen] = useState(false)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function clearTimers() {
    if (openTimer.current) clearTimeout(openTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
    openTimer.current = null
    closeTimer.current = null
  }
  function scheduleOpen() {
    clearTimers()
    openTimer.current = setTimeout(() => setOpen(true), 240)
  }
  function scheduleClose() {
    clearTimers()
    closeTimer.current = setTimeout(() => setOpen(false), 140)
  }
  function openNow() {
    clearTimers()
    setOpen(true)
  }
  useEffect(() => () => clearTimers(), [])

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
      const body = (await res.json()) as { viewerSaved: boolean }
      setSaved(body.viewerSaved)
    } catch {
      setSaved(prevSaved)
      setSaveError(true)
    } finally {
      setSaveBusy(false)
    }
  }

  // Garante o SAVE base (Todos) sem alternar — usado quando se marca uma Coleção numa Receita ainda
  // não-salva (o server barra add de não-salva; salvar primeiro faz o bookmark encher também).
  async function ensureSaved(): Promise<boolean> {
    if (saved) return true
    try {
      const res = await fetch(`/api/recipes/${recipeId}/save`, { method: 'POST' })
      if (!res.ok) {
        setSaveError(true)
        return false
      }
      const body = (await res.json()) as { viewerSaved: boolean }
      setSaved(!!body.viewerSaved)
      return !!body.viewerSaved
    } catch {
      setSaveError(true)
      return false
    }
  }

  if (mode === 'pending') return null

  if (mode === 'anon') {
    // Anônimo: o bookmark É o convite — leva ao /sign-in. Sem popover (não há o que organizar).
    return (
      <div className="flex flex-col items-end gap-1">
        <Link href="/sign-in" aria-label={m.convidaEntrarSalvar} className={ICON_BUTTON}>
          <Bookmark className="size-5" strokeWidth={1.5} aria-hidden />
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <button
            type="button"
            onClick={() => {
              void handleSave()
              openNow()
            }}
            onMouseEnter={scheduleOpen}
            onMouseLeave={scheduleClose}
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
        </PopoverAnchor>
        <PopoverContent
          onMouseEnter={clearTimers}
          onMouseLeave={scheduleClose}
          onOpenAutoFocus={(e) => {
            // Aberto por HOVER não deve roubar o foco (só o teclado tabula pra dentro).
            e.preventDefault()
          }}
        >
          <CollectionPanel recipeId={recipeId} saved={saved} ensureSaved={ensureSaved} />
        </PopoverContent>
      </Popover>

      {saveError && (
        <p role="alert" className="text-sm font-medium text-fg">
          {m.erroSalvar}
        </p>
      )}
    </div>
  )
}

/**
 * Painel de Coleção do detalhe (#364) — conteúdo do Popover ancorado ao bookmark (estilo Instagram).
 * Carrega a membership ao MONTAR (o Popover só monta ao abrir). Cada coleção é um checkbox (contains);
 * marcar numa Receita ainda NÃO-salva chama `ensureSaved()` primeiro (o server rejeita add de
 * não-salva com 422). Criar coleção inline já adiciona a Receita à nova pasta.
 */
type Membership = { id: string; name: string; contains: boolean }

function CollectionPanel({
  recipeId,
  saved,
  ensureSaved,
}: {
  recipeId: string
  saved: boolean
  ensureSaved: () => Promise<boolean>
}) {
  const { messages } = useLocale()
  const m = messages.colecoes
  const [items, setItems] = useState<Membership[] | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('loading')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    // `status` já nasce 'loading' (useState); o Popover só monta este painel ao abrir.
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
    // Otimista: alterna já; reverte no erro. Ao ADICIONAR numa Receita não-salva, salva antes.
    setItems((prev) => prev?.map((c) => (c.id === id ? { ...c, contains: !contains } : c)) ?? prev)
    try {
      if (!contains && !saved) {
        const ok = await ensureSaved()
        if (!ok) throw new Error('save_failed')
      }
      const res = contains
        ? await fetch(`/api/me/collections/${id}/items/${recipeId}`, { method: 'DELETE' })
        : await fetch(`/api/me/collections/${id}/items`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ recipeId }),
          })
      if (!res.ok) throw new Error('item_failed')
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
      // Criar coleção já implica salvar a Receita (a nova coleção recebe a Receita).
      if (!saved) {
        const ok = await ensureSaved()
        if (!ok) {
          setCreateError(m.erro)
          return
        }
      }
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
