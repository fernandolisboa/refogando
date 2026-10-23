'use client'

/**
 * Aba "Usuários" do Console (admin-only; substitui a antiga aba "Papéis", que exigia já conhecer o usuário).
 * Lista as contas por ATALHO (Todos, Novos, Sem papel, Equipe, Cadastro pendente, Pro, Desativadas), com
 * busca por nome/@handle/email/ID, ordenação e paginação — tudo no servidor (GET /api/admin/users). Clicar
 * numa conta abre a gaveta de detalhes, onde o papel muda (PUT /api/admin/roles, ADR-0010: fetch ao route
 * handler). O servidor recusa mudar o próprio papel (`papel_proprio`); a UI já desabilita esse caso.
 *
 * Email é dado pessoal e só aparece aqui, para admin. Nada desta tela vai a log. Cores: só tokens AA da #54;
 * sem erva (exclusiva do selo do Catálogo) e sem âmbar (exclusivo do aviso de restrição), ADR-0015.
 */
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Search } from 'lucide-react'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/profile/avatar'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ROLES, type Role } from '@/domain/user'
import { formatDate, formatDateTime, formatRelativeTime } from '@/domain/relative-time'
import {
  ADMIN_USER_PRESETS,
  ADMIN_USER_SORTS,
  hoursUntil,
  type AdminUserListItem,
  type AdminUserListPage,
  type AdminUserPreset,
  type AdminUserSort,
  type AdminUserStatus,
} from '@/domain/admin-user-list'

const SEARCH_DEBOUNCE_MS = 300

type Params = { preset: AdminUserPreset; q: string; sort: AdminUserSort; page: number }
type Loaded = { key: string; data: AdminUserListPage | null }

const PRESET_LABEL = {
  todos: 'usuariosPresetTodos',
  novos: 'usuariosPresetNovos',
  'sem-papel': 'usuariosPresetSemPapel',
  equipe: 'usuariosPresetEquipe',
  pendentes: 'usuariosPresetPendentes',
  pro: 'usuariosPresetPro',
  desativadas: 'usuariosPresetDesativadas',
} as const satisfies Record<AdminUserPreset, string>

const SORT_LABEL = {
  recentes: 'usuariosOrdemRecentes',
  antigos: 'usuariosOrdemAntigos',
  acesso: 'usuariosOrdemAcesso',
  nome: 'usuariosOrdemNome',
} as const satisfies Record<AdminUserSort, string>

const ROLE_LABEL = {
  usuario: 'papelUsuario',
  curador: 'papelCurador',
  admin: 'papelAdmin',
} as const satisfies Record<Role, string>

const ROLE_DESC = {
  usuario: 'usuariosPapelDescUsuario',
  curador: 'usuariosPapelDescCurador',
  admin: 'usuariosPapelDescAdmin',
} as const satisfies Record<Role, string>

const ROLE_PILL: Record<Role, string> = {
  usuario: 'border-border text-muted',
  curador: 'border-brand/60 text-brand-ink',
  admin: 'border-transparent bg-brand/15 text-brand-ink',
}

const INACTIVE: readonly AdminUserStatus[] = ['desativada', 'eliminada']

function RolePill({ role, label }: { role: Role; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap',
        ROLE_PILL[role],
      )}
    >
      {label}
    </span>
  )
}

export function UsersSection() {
  const { messages, locale } = useLocale()
  const m = messages.admin
  const meId = useSession().data?.user.id ?? null

  const [params, setParams] = useState<Params>({ preset: 'todos', q: '', sort: 'recentes', page: 1 })
  const [query, setQuery] = useState('')
  const [reload, setReload] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const key = `${params.preset}|${params.q}|${params.sort}|${params.page}|${reload}`
  const loading = loaded?.key !== key
  const data = loaded?.data ?? null
  const failed = !loading && loaded?.data === null

  // Busca no servidor. TODO setState vive nos callbacks da promise (nunca no corpo do efeito —
  // react-hooks/set-state-in-effect); o AbortController descarta a resposta de um filtro já trocado.
  useEffect(() => {
    const ctrl = new AbortController()
    const qs = new URLSearchParams({
      preset: params.preset,
      sort: params.sort,
      page: String(params.page),
      ...(params.q ? { q: params.q } : {}),
    })
    fetch(`/api/admin/users?${qs}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const body = (await res.json()) as AdminUserListPage
        setNow(Date.now())
        setLoaded({ key, data: body })
        // A lista encolheu (papel mudou, conta saiu do filtro) e a página atual ficou além da última:
        // volta para a última página que existe, em vez de "Mostrando 51–50 de 50" sobre uma lista vazia.
        const last = Math.max(1, Math.ceil(body.total / body.pageSize))
        if (body.users.length === 0 && body.total > 0 && body.page > last) {
          setParams((p) => (p.page === params.page ? { ...p, page: last } : p))
        }
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setLoaded({ key, data: null })
      })
    return () => ctrl.abort()
  }, [key, params])

  // Debounce da busca: o termo só vai para `params` (e para o servidor) depois de 300 ms parado.
  useEffect(() => {
    const q = query.trim()
    if (q === params.q) return
    const t = setTimeout(() => setParams((p) => ({ ...p, q, page: 1 })), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query, params.q])

  // Gaveta de detalhes: a linha escolhida (cópia, para o papel atualizar sem esperar o recarregamento).
  const [selected, setSelected] = useState<AdminUserListItem | null>(null)
  const [nextRole, setNextRole] = useState<Role>('usuario')
  const [saving, setSaving] = useState(false)
  const [roleStatus, setRoleStatus] = useState<
    | 'done'
    | 'erroPapelInvalido'
    | 'erroNaoAplicado'
    | 'usuariosPapelProprio'
    | 'usuariosPapelContaInativa'
    | 'erroGenerico'
    | null
  >(null)
  const [copied, setCopied] = useState(false)

  // Quem abriu a gaveta (a gaveta é controlada, sem SheetTrigger): o foco volta pra ele ao fechar.
  const openerRef = useRef<HTMLElement | null>(null)

  function open(u: AdminUserListItem, opener?: HTMLElement) {
    openerRef.current = opener ?? null
    setSelected(u)
    setNextRole(u.role)
    setRoleStatus(null)
    setCopied(false)
  }

  async function applyRole(e: React.FormEvent) {
    e.preventDefault()
    if (!selected || saving || nextRole === selected.role) return
    setSaving(true)
    setRoleStatus(null)
    try {
      const res = await fetch('/api/admin/roles', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: selected.id, role: nextRole }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setRoleStatus(
          body?.error === 'papel_invalido'
            ? 'erroPapelInvalido'
            : body?.error === 'papel_proprio'
              ? 'usuariosPapelProprio'
              : body?.error === 'papel_conta_inativa'
                ? 'usuariosPapelContaInativa'
                : body?.error === 'papel_nao_aplicado'
                  ? 'erroNaoAplicado'
                  : 'erroGenerico',
        )
        return
      }
      // Funcional: a gaveta não fecha durante o PUT, mas a linha guardada pode ter sido trocada pela recarga.
      setSelected((s) => (s?.id === selected.id ? { ...s, role: nextRole } : s))
      setRoleStatus('done')
      setReload((n) => n + 1) // contagens da tira e a linha refletem o papel novo
    } catch {
      setRoleStatus('erroGenerico')
    } finally {
      setSaving(false)
    }
  }

  async function copyId() {
    if (!selected) return
    try {
      await navigator.clipboard.writeText(selected.id)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const statusLabel = (u: AdminUserListItem): string => {
    switch (u.status) {
      case 'ativa':
        return m.usuariosStatusAtiva
      case 'nao-confirmada':
        return m.usuariosStatusNaoConfirmada
      case 'pendente':
        // Prazo vencido (o expurgo diário ainda não passou): sem "expira em 0 h".
        return u.pendingPurgeAt && hoursUntil(u.pendingPurgeAt, now) > 0
          ? m.usuariosStatusPendenteExpira.replace('{h}', String(hoursUntil(u.pendingPurgeAt, now)))
          : m.usuariosStatusPendente
      case 'desativada':
        return m.usuariosStatusDesativada
      case 'eliminada':
        return m.usuariosStatusEliminada
    }
  }
  const lastSeen = (u: AdminUserListItem) =>
    u.lastSeenAt ? formatRelativeTime(u.lastSeenAt, now, locale) : m.usuariosSemSessao
  const planLabel = (u: AdminUserListItem) => (u.plan === 'pro' ? m.planoPlanoPro : m.planoPlanoFree)

  const total = data?.total ?? 0
  const pageSize = data?.pageSize ?? 25
  const pages = Math.max(1, Math.ceil(total / pageSize))
  // Faixa da página CARREGADA (`data.page`, já com o teto do servidor), não da pedida: durante a recarga o
  // rodapé segue descrevendo as linhas na tela.
  const shownPage = data?.page ?? params.page
  const from = total === 0 ? 0 : (shownPage - 1) * pageSize + 1
  const to = Math.min(total, shownPage * pageSize)
  const users = data?.users ?? []
  const selfSelected = selected != null && selected.id === meId
  // Sessão ainda carregando: não dá para saber se a linha é a própria conta, então o papel fica travado.
  const roleLocked = meId == null || selfSelected
  const inactiveSelected = selected != null && INACTIVE.includes(selected.status)

  const nameButton = (u: AdminUserListItem, avatar: 'sm' | 'md') => (
    <button
      type="button"
      onClick={(e) => open(u, e.currentTarget)}
      aria-label={m.usuariosAbrirDetalhes.replace('{nome}', u.name)}
      className="flex min-w-0 items-center gap-3 rounded-md text-left"
    >
      <Avatar src={u.image} name={u.name} alt="" size={avatar} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold text-fg">
          {u.name}
          {u.id === meId && <span className="ml-1.5 text-xs font-medium text-muted">({m.usuariosVoce})</span>}
        </span>
        <span className="truncate text-xs text-muted">@{u.handle}</span>
      </span>
    </button>
  )

  return (
    <div className="flex flex-col gap-5">
      <div role="group" aria-label={m.usuariosAtalhosAria} className="flex flex-wrap gap-2">
        {ADMIN_USER_PRESETS.map((p) => {
          const on = params.preset === p
          return (
            <button
              key={p}
              type="button"
              aria-pressed={on}
              onClick={() => setParams((s) => (s.preset === p ? s : { ...s, preset: p, page: 1 }))}
              className={cn(
                'inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors',
                on ? 'border-fg bg-fg text-bg' : 'border-border text-fg hover:border-brand-ink',
              )}
            >
              {m[PRESET_LABEL[p]]}
              {data && ' '}
              {data && (
                <span className={cn('text-xs font-medium', on ? 'text-bg/75' : 'text-muted')}>
                  {data.counts[p]}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <section aria-label={m.usuariosTabelaAria} className="overflow-hidden p-0 sm:p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <label className="relative flex min-w-56 flex-1 items-center sm:max-w-md">
            <span className="sr-only">{m.usuariosBuscaLabel}</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 size-4 text-muted" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={m.usuariosBuscaPlaceholder}
              autoComplete="off"
              className="pl-9"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-muted">
            {m.usuariosOrdenarLabel}
            <select
              value={params.sort}
              onChange={(e) =>
                setParams((s) =>
                  s.sort === e.target.value ? s : { ...s, sort: e.target.value as AdminUserSort, page: 1 },
                )
              }
              className="h-9 rounded-md border border-border bg-bg px-2 text-sm text-fg"
            >
              {ADMIN_USER_SORTS.map((s) => (
                <option key={s} value={s}>
                  {m[SORT_LABEL[s]]}
                </option>
              ))}
            </select>
          </label>
          <span aria-live="polite" className="ml-auto text-sm text-muted">
            {loading
              ? m.usuariosCarregando
              : total === 1
                ? m.usuariosTotalUm
                : m.usuariosTotal.replace('{n}', String(total))}
          </span>
        </div>

        {failed ? (
          <div role="alert" className="flex flex-col items-start gap-3 px-4 py-8 text-sm">
            <p className="text-fg">{m.usuariosErroCarregar}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>
              {m.usuariosTentarDeNovo}
            </Button>
          </div>
        ) : !loading && users.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">{m.usuariosVazio}</p>
        ) : (
          <div aria-busy={loading} className={cn('transition-opacity', loading && 'opacity-60')}>
            {/* Desktop/tablet: tabela (rola na horizontal se faltar largura). */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[48rem] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs tracking-wider text-muted uppercase">
                    <th scope="col" className="px-4 py-2.5 font-semibold">{m.usuariosColUsuario}</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">{m.usuariosColEmail}</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">{m.usuariosColPapelPlano}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">{m.usuariosColReceitas}</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">{m.usuariosColCadastro}</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">{m.usuariosColAcesso}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      className={cn(
                        'border-t border-border transition-colors hover:bg-bg/60',
                      )}
                    >
                      <td className="max-w-64 px-4 py-3">{nameButton(u, 'sm')}</td>
                      <td className="max-w-72 px-4 py-3">
                        <span className="block truncate text-fg" title={u.email}>
                          {u.email}
                        </span>
                        <span
                          className={cn(
                            'block text-xs',
                            u.status === 'pendente' ? 'text-brand-ink' : 'text-muted',
                          )}
                        >
                          {statusLabel(u)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <RolePill role={u.role} label={m[ROLE_LABEL[u.role]]} />
                        <span className="mt-1 block text-xs text-muted">{planLabel(u)}</span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{u.recipeCount}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <time dateTime={u.createdAt} title={formatDateTime(u.createdAt, locale)}>
                          {formatRelativeTime(u.createdAt, now, locale)}
                        </time>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted">{lastSeen(u)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Celular: lista compacta. */}
            <ul className="flex flex-col md:hidden">
              {users.map((u, i) => (
                <li
                  key={u.id}
                  className={cn(
                    'flex flex-col gap-1.5 px-4 py-3',
                    i > 0 && 'border-t border-border',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    {nameButton(u, 'md')}
                    <RolePill role={u.role} label={m[ROLE_LABEL[u.role]]} />
                  </div>
                  <p className="truncate text-xs text-muted">{u.email}</p>
                  <p className={cn('text-xs', u.status === 'pendente' ? 'text-brand-ink' : 'text-muted')}>
                    {statusLabel(u)} · {planLabel(u)} · {m.usuariosColReceitas}: {u.recipeCount}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {data && users.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted">
            <span>
              {m.usuariosPaginacao
                .replace('{de}', String(from))
                .replace('{ate}', String(to))
                .replace('{total}', String(total))}
            </span>
            <span className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={params.page <= 1 || loading}
                onClick={() => setParams((s) => ({ ...s, page: s.page - 1 }))}
              >
                <ChevronLeft aria-hidden="true" />
                {m.usuariosAnterior}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={params.page >= pages || loading}
                onClick={() => setParams((s) => ({ ...s, page: s.page + 1 }))}
              >
                {m.usuariosProxima}
                <ChevronRight aria-hidden="true" />
              </Button>
            </span>
          </div>
        )}
      </section>

      {/* Não fecha com o PUT em voo (mesmo padrão da gaveta de criar receita do Catálogo). */}
      <Sheet open={selected != null} onOpenChange={(o) => !o && !saving && setSelected(null)}>
        <SheetContent
          side="right"
          closeLabel={m.fechar}
          className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl lg:max-w-2xl"
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            openerRef.current?.focus()
          }}
        >
          {selected && (
            <>
              <SheetHeader className="flex-row items-center gap-4 border-b border-border px-6 py-5 pr-14">
                <Avatar src={selected.image} name={selected.name} alt="" size="md" />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <SheetTitle className="truncate text-xl text-fg">{selected.name}</SheetTitle>
                  <SheetDescription className="truncate text-sm text-muted">@{selected.handle}</SheetDescription>
                </div>
              </SheetHeader>

              <div className="flex flex-1 flex-col gap-6 px-6 py-5">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                  <div className="flex flex-col gap-0.5 sm:col-span-2">
                    <dt className="text-xs text-muted">{m.usuariosDetalheEmail}</dt>
                    <dd className="break-all text-fg">{selected.email}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted">{m.usuariosDetalheSituacao}</dt>
                    <dd className={selected.status === 'pendente' ? 'text-brand-ink' : 'text-fg'}>
                      {statusLabel(selected)}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted">{m.usuariosDetalhePlano}</dt>
                    <dd className="text-fg">{planLabel(selected)}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted">{m.usuariosDetalheCadastro}</dt>
                    <dd className="text-fg">{formatDateTime(selected.createdAt, locale)}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted">{m.usuariosDetalheAcesso}</dt>
                    <dd className="text-fg">
                      {selected.lastSeenAt ? formatDateTime(selected.lastSeenAt, locale) : m.usuariosSemSessao}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted">{m.usuariosDetalheReceitas}</dt>
                    <dd className="text-fg">
                      {m.usuariosDetalheReceitasValor
                        .replace('{n}', String(selected.recipeCount))
                        .replace('{p}', String(selected.publicRecipeCount))}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted">{m.usuariosDetalheIdioma}</dt>
                    <dd className="text-fg">{selected.locale ?? '—'}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted">{m.usuariosDetalheImagem}</dt>
                    <dd className="text-fg">
                      {selected.imageGenBlocked ? m.usuariosImagemBloqueada : m.usuariosImagemLiberada}
                    </dd>
                  </div>
                  {selected.deletedAt && (
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-xs text-muted">{m.usuariosDetalheDesativadaEm}</dt>
                      <dd className="text-fg">{formatDate(selected.deletedAt, locale)}</dd>
                    </div>
                  )}
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <dt className="text-xs text-muted">{m.usuariosDetalheId}</dt>
                    <dd className="flex flex-wrap items-center gap-2">
                      <code className="font-mono text-xs break-all text-fg">{selected.id}</code>
                      <Button type="button" variant="ghost" size="sm" onClick={copyId}>
                        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                        {copied ? m.usuariosIdCopiado : m.usuariosCopiarId}
                      </Button>
                    </dd>
                  </div>
                </dl>

                {selected.status === 'ativa' || selected.status === 'nao-confirmada' ? (
                  <a
                    href={`/u/${selected.handle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-brand-ink hover:underline"
                  >
                    {m.usuariosVerPerfil}
                    <span className="sr-only"> ({messages.footer.abreEmNovaAba})</span>
                    <ExternalLink aria-hidden="true" className="size-3.5" />
                  </a>
                ) : null}

                <form onSubmit={applyRole} className="flex flex-col gap-4">
                  <fieldset
                    disabled={roleLocked || inactiveSelected || saving}
                    aria-describedby={
                      selfSelected ? 'papel-trava-propria' : inactiveSelected ? 'papel-trava-inativa' : undefined
                    }
                    className="flex flex-col gap-2 rounded-lg border border-border p-4"
                  >
                    <legend className="px-1.5 text-sm font-semibold text-fg">{m.usuariosPapelLegenda}</legend>
                    {ROLES.map((r) => {
                      const checked = nextRole === r
                      return (
                        <label
                          key={r}
                          className={cn(
                            'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors',
                            checked ? 'border-brand bg-brand/8' : 'border-border hover:border-brand-ink',
                          )}
                        >
                          <input
                            type="radio"
                            name="papel"
                            value={r}
                            checked={checked}
                            onChange={() => {
                              setNextRole(r)
                              setRoleStatus(null)
                            }}
                            className="mt-1 accent-brand-strong"
                          />
                          <span className="flex flex-col gap-0.5">
                            <span className="text-sm font-semibold text-fg">
                              {m[ROLE_LABEL[r]]}
                              {selected.role === r && (
                                <span className="ml-1.5 text-xs font-medium text-muted">· {m.usuariosPapelAtual}</span>
                              )}
                            </span>
                            <span className="text-xs text-muted">{m[ROLE_DESC[r]]}</span>
                          </span>
                        </label>
                      )
                    })}
                  </fieldset>

                  {selfSelected && (
                    <p id="papel-trava-propria" className="text-sm text-muted">
                      {m.usuariosPapelProprio}
                    </p>
                  )}
                  {inactiveSelected && (
                    <p id="papel-trava-inativa" className="text-sm text-muted">
                      {m.usuariosPapelContaInativa}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center justify-end gap-3">
                    {roleStatus === 'done' && (
                      <p role="status" className="mr-auto text-sm font-medium text-brand-ink">
                        {m.promovido}
                      </p>
                    )}
                    {roleStatus && roleStatus !== 'done' && (
                      <p role="alert" className="mr-auto text-sm font-medium text-fg">
                        {m[roleStatus]}
                      </p>
                    )}
                    <Button
                      type="submit"
                      disabled={roleLocked || inactiveSelected || saving || nextRole === selected.role}
                      aria-busy={saving}
                    >
                      {saving ? m.aplicandoPapel : m.aplicarPapel}
                    </Button>
                  </div>
                </form>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
