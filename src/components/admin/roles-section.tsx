'use client'

/**
 * Definir papel de usuário (#63/#269, AC1) — Admin-only (o `AdminConsole` só a monta para
 * `role==='admin'`; o servidor reforça com requireRole 'admin'). A ação é GENÉRICA de set-role: o
 * select inclui `usuario` (ROLES[0]), então PROMOVE e REBAIXA (admin→usuário); por isso o rótulo do
 * botão é neutro (`aplicarPapel`/`aplicandoPapel`), não "Promover", e a mensagem de sucesso é
 * neutra ("Papel atualizado.").
 *
 * #269: em vez de COLAR um UUID, o admin BUSCA por nome/@handle/email/ID (GET /api/admin/users/search,
 * debounce de timers reais) e escolhe um candidato (avatar + nome + @handle + email — email só admin)
 * de uma lista de BOTÕES (a11y nativa; sem combobox ARIA frágil). Selecionar trava o usuário; o
 * `userId` da atribuição vem do candidato. A atribuição em si é INALTERADA (ADR-0010: PUT
 * /api/admin/roles via fetch).
 *
 * Discriminação de erro por CHAVE do corpo `{error}`, NUNCA por status: `papel_invalido` → papel
 * fora de ROLES; `papel_nao_aplicado` → não deu para aplicar; qualquer outra não-ok → `erroGenerico`.
 * Cores: só neutros/brand AA-verificados; sem âmbar/accent.
 */
import { useEffect, useRef, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { fieldClassName } from '@/components/button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/profile/avatar'
import { ROLES, type Role } from '@/domain/user'
import type { AdminUserResult } from '@/domain/user-search-read'

const SEARCH_DEBOUNCE_MS = 300

export function RolesSection() {
  const { messages } = useLocale()
  const m = messages.admin

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AdminUserResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<AdminUserResult | null>(null)
  const [role, setRole] = useState<Role>('curador')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'done' | 'error'>('idle')
  const [errorKey, setErrorKey] = useState<
    'erroPapelInvalido' | 'erroNaoAplicado' | 'erroGenerico' | null
  >(null)

  // Rótulo localizado por valor de papel — `satisfies Record<Role,string>` trava drift do enum.
  const roleLabel = {
    usuario: m.papelUsuario,
    curador: m.papelCurador,
    admin: m.papelAdmin,
  } satisfies Record<Role, string>

  // Busca com debounce de timers REAIS (precedente: search-experience). Só agenda a busca quando há
  // termo e NENHUM usuário selecionado. TODO o setState mora DENTRO do callback do timer (não no
  // corpo do efeito — evita cascata de render, react-hooks/set-state-in-effect; mesmo padrão do
  // web-search-config). `reqId` descarta respostas obsoletas (uma busca lenta não sobrescreve a
  // atual nem uma seleção já feita). Limpar a lista no termo-vazio é feito no onChange (evento, não
  // efeito).
  const reqId = useRef(0)
  useEffect(() => {
    const q = query.trim()
    if (selected || q.length === 0) return
    const id = ++reqId.current
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/admin/users/search?q=${encodeURIComponent(q)}`)
        const body = res.ok
          ? ((await res.json().catch(() => null)) as { results?: AdminUserResult[] } | null)
          : null
        if (id !== reqId.current) return // resposta obsoleta — ignora
        setResults(body?.results ?? [])
      } catch {
        if (id === reqId.current) setResults([])
      } finally {
        if (id === reqId.current) setSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query, selected])

  function onQueryChange(value: string) {
    setQuery(value)
    // Limpa a lista A CADA edição (candidatos obsoletos somem na hora, não ficam clicáveis até a
    // próxima resposta) e invalida buscas em voo. `searching` reflete "há termo a buscar" — assim a
    // região viva diz "Buscando…" durante o debounce, sem piscar "Nenhum encontrado".
    reqId.current += 1
    setResults([])
    setSearching(value.trim().length > 0)
  }
  function pick(u: AdminUserResult) {
    reqId.current += 1 // descarta resposta em voo (não repovoa a lista após escolher)
    setSelected(u)
    setResults([])
    setSearching(false)
    setStatus('idle')
    setErrorKey(null)
  }
  function clearSelection() {
    reqId.current += 1
    setSelected(null)
    setResults([])
    setSearching(query.trim().length > 0)
    setStatus('idle')
    setErrorKey(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selected || saving) return
    setSaving(true)
    setStatus('idle')
    setErrorKey(null)
    try {
      const res = await fetch('/api/admin/roles', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: selected.id, role }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setErrorKey(
          body?.error === 'papel_invalido'
            ? 'erroPapelInvalido'
            : body?.error === 'papel_nao_aplicado'
              ? 'erroNaoAplicado'
              : 'erroGenerico',
        )
        setStatus('error')
        return
      }
      setStatus('done')
    } catch {
      setErrorKey('erroGenerico')
      setStatus('error')
    } finally {
      setSaving(false)
    }
  }

  // Identidade visual de um candidato/selecionado: avatar decorativo + nome + @handle (+email admin).
  const identity = (u: AdminUserResult) => (
    <>
      <Avatar src={u.image} name={u.name} alt="" size="sm" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-fg">{u.name}</span>
        <span className="truncate text-xs text-muted">
          @{u.handle}
          {u.email ? ` · ${u.email}` : ''}
        </span>
      </span>
    </>
  )

  return (
    <section aria-labelledby="papeis-titulo" className="flex flex-col gap-3">
      <h2 id="papeis-titulo" className="font-display text-lg font-semibold text-fg">
        {m.papeisTitulo}
      </h2>

      {!selected ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm font-medium text-fg">
            {m.buscaUsuarioLabel}
            <Input
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={m.buscaUsuarioPlaceholder}
              autoComplete="off"
            />
          </label>
          {/* Região viva: leitores de tela ouvem "Buscando…" / "N resultado(s)" / "Nenhum
              usuário encontrado" (a lista em si não é viva — o anúncio do COUNT cobre o gap). */}
          <div aria-live="polite" className="min-h-5 text-sm text-muted">
            {searching
              ? m.buscaUsuarioCarregando
              : results.length > 0
                ? m.buscaUsuarioContagem.replace('{n}', String(results.length))
                : query.trim().length > 0
                  ? m.buscaUsuarioVazio
                  : null}
          </div>
          {results.length > 0 && (
            <ul aria-label={m.buscaUsuarioResultados} className="flex flex-col gap-1">
              {results.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => pick(u)}
                    className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left transition-colors hover:border-brand-ink hover:bg-brand/10"
                  >
                    {identity(u)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* Caption acessível: distingue o usuário ESCOLHIDO de um candidato qualquer (a11y). */}
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {m.usuarioSelecionado}
          </p>
          <div
            aria-label={`${m.usuarioSelecionado}: ${selected.name}`}
            className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
          >
            {identity(selected)}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              className="ml-auto shrink-0"
            >
              {m.trocarUsuario}
            </Button>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-col gap-1 text-sm font-medium text-fg">
              {m.papelLabel}
              <select
                value={role}
                onChange={(e) => {
                  setRole(e.target.value as Role)
                  setStatus('idle')
                }}
                className={fieldClassName}
              >
                {ROLES.map((value) => (
                  <option key={value} value={value}>
                    {roleLabel[value]}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="submit"
              size="sm"
              disabled={saving}
              aria-busy={saving}
              className="disabled:opacity-70"
            >
              {saving ? m.aplicandoPapel : m.aplicarPapel}
            </Button>
          </div>
        </form>
      )}

      {status === 'done' && (
        <p role="status" aria-live="polite" className="text-sm font-medium text-brand-ink">
          {m.promovido}
        </p>
      )}
      {status === 'error' && errorKey && (
        <p
          role="alert"
          className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
        >
          {m[errorKey]}
        </p>
      )}
    </section>
  )
}
