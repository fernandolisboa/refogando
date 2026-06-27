'use client'

/**
 * Taxonomia de cozinhas (#321, Governança) — Admin-only (o gate de rota monta a página só pra
 * admin; o servidor reforça com requireRole 'admin'). Curadoria PROATIVA: adicionar, renomear e
 * depreciar/reativar cozinhas. NÃO há hard-delete (só depreciar), nem mexe em sugestões #319 (a
 * rota recusa com 404 — esta UI só lista active/deprecated).
 *
 * ADR-0010: consome os ROUTE HANDLERS `GET/POST/PATCH /api/admin/vocabulary` via `fetch`. O
 * servidor é a verdade (validação de slug/rótulo + fronteira proativa×reativa vivem lá).
 *
 * Erros discriminados pela CHAVE do corpo `{error}` (NUNCA por status): cada chave conhecida
 * vira uma mensagem; qualquer não-ok desconhecida → `vocabErroInterno`. Cores: só tokens
 * AA-verificados (neutros + brand); sem âmbar/destructive.
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Cozinha = {
  slug: string
  labelPtBr: string | null
  labelEnUs: string | null
  status: 'active' | 'deprecated'
  sort: number
}

type ErroChave =
  | 'vocabErroSlug'
  | 'vocabErroRotulos'
  | 'vocabErroSlugEmUso'
  | 'vocabErroNaoEncontrado'
  | 'vocabErroInterno'

/** Mapeia a CHAVE do corpo `{error}` da rota → chave de i18n. Desconhecida → erro interno. */
function erroChave(key: string | undefined): ErroChave {
  switch (key) {
    case 'slug_invalido':
      return 'vocabErroSlug'
    case 'rotulos_invalidos':
      return 'vocabErroRotulos'
    case 'slug_em_uso':
      return 'vocabErroSlugEmUso'
    case 'nao_encontrado':
      return 'vocabErroNaoEncontrado'
    default:
      return 'vocabErroInterno'
  }
}

export function VocabularySection() {
  const { messages } = useLocale()
  const m = messages.admin

  const [cozinhas, setCozinhas] = useState<Cozinha[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  // Form de adicionar.
  const [slug, setSlug] = useState('')
  const [addPt, setAddPt] = useState('')
  const [addEn, setAddEn] = useState('')
  const [adding, setAdding] = useState(false)

  // Edição inline (slug em edição → rascunho dos rótulos).
  const [editing, setEditing] = useState<string | null>(null)
  const [editPt, setEditPt] = useState('')
  const [editEn, setEditEn] = useState('')
  const [savingRow, setSavingRow] = useState<string | null>(null)

  const [errorKey, setErrorKey] = useState<ErroChave | null>(null)
  const [okMessage, setOkMessage] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/admin/vocabulary')
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const body = (await res.json()) as { cozinhas: Cozinha[] }
      setCozinhas(body.cozinhas)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Carrega uma vez na montagem num timer (não no corpo síncrono do effect — evita cascata de
    // setState na montagem; mesmo padrão de config-section). O cleanup cancela se desmontar antes.
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [])

  /** Aplica/insere uma cozinha devolvida pela rota no estado local (ordena por sort, slug). */
  function upsertRow(row: Cozinha) {
    setCozinhas((prev) => {
      const rest = prev.filter((c) => c.slug !== row.slug)
      return [...rest, row].sort((a, b) => a.sort - b.sort || a.slug.localeCompare(b.slug))
    })
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (adding) return
    setAdding(true)
    setErrorKey(null)
    setOkMessage(null)
    try {
      const res = await fetch('/api/admin/vocabulary', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, labelPtBr: addPt, labelEnUs: addEn }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setErrorKey(erroChave(body?.error))
        return
      }
      const body = (await res.json()) as { cozinha: Cozinha }
      upsertRow(body.cozinha)
      setSlug('')
      setAddPt('')
      setAddEn('')
      setOkMessage(m.vocabSalvo)
    } catch {
      setErrorKey('vocabErroInterno')
    } finally {
      setAdding(false)
    }
  }

  function startEdit(c: Cozinha) {
    setEditing(c.slug)
    setEditPt(c.labelPtBr ?? '')
    setEditEn(c.labelEnUs ?? '')
    setErrorKey(null)
    setOkMessage(null)
  }

  async function patch(slugToPatch: string, payload: Record<string, unknown>) {
    setSavingRow(slugToPatch)
    setErrorKey(null)
    setOkMessage(null)
    try {
      const res = await fetch('/api/admin/vocabulary', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: slugToPatch, ...payload }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setErrorKey(erroChave(body?.error))
        return false
      }
      const body = (await res.json()) as { cozinha: Cozinha | null }
      if (body.cozinha) upsertRow(body.cozinha)
      setOkMessage(m.vocabSalvo)
      return true
    } catch {
      setErrorKey('vocabErroInterno')
      return false
    } finally {
      setSavingRow(null)
    }
  }

  async function handleSaveLabels(slugToSave: string) {
    const ok = await patch(slugToSave, { labelPtBr: editPt, labelEnUs: editEn })
    if (ok) setEditing(null)
  }

  function statusLabel(status: Cozinha['status']) {
    return status === 'active' ? m.vocabStatusAtiva : m.vocabStatusDepreciada
  }

  return (
    <section aria-labelledby="vocab-titulo" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="vocab-titulo" className="font-display text-lg font-semibold text-fg">
          {m.vocabTitulo}
        </h2>
        <p className="text-sm text-muted">{m.vocabDescricao}</p>
      </div>

      {/* Form de adicionar. */}
      <form onSubmit={handleAdd} className="flex flex-col gap-3 rounded-md border border-border p-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-fg">
          {m.vocabSlugLabel}
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-fg">
            {m.vocabRotuloPt}
            <Input value={addPt} onChange={(e) => setAddPt(e.target.value)} autoComplete="off" />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-fg">
            {m.vocabRotuloEn}
            <Input value={addEn} onChange={(e) => setAddEn(e.target.value)} autoComplete="off" />
          </label>
        </div>
        <Button type="submit" size="sm" disabled={adding} aria-busy={adding} className="self-start">
          {adding ? m.vocabAdicionando : m.vocabAdicionar}
        </Button>
      </form>

      {/* Mensagens (sucesso/erro). */}
      {okMessage && (
        <p role="status" aria-live="polite" className="text-sm font-medium text-brand-ink">
          {okMessage}
        </p>
      )}
      {errorKey && (
        <p
          role="alert"
          className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
        >
          {m[errorKey]}
        </p>
      )}

      {/* Lista de cozinhas. */}
      {loading ? (
        <p aria-live="polite" className="text-sm text-muted">
          {m.vocabCarregando}
        </p>
      ) : loadError ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-sm font-medium text-fg">
            {m.vocabErroCarregar}
          </p>
          <Button type="button" size="sm" variant="ghost" onClick={() => void load()}>
            {m.vocabTentarNovamente}
          </Button>
        </div>
      ) : (
        <ul aria-label={m.vocabTitulo} className="flex flex-col gap-2">
          {cozinhas.map((c) => {
            const busy = savingRow === c.slug
            const isEditing = editing === c.slug
            return (
              <li
                key={c.slug}
                className="flex flex-col gap-2 rounded-md border border-border px-3 py-2"
              >
                {isEditing ? (
                  <div className="flex flex-col gap-2">
                    <span className="font-mono text-xs text-muted">{c.slug}</span>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-fg">
                        {m.vocabRotuloPt}
                        <Input value={editPt} onChange={(e) => setEditPt(e.target.value)} />
                      </label>
                      <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-fg">
                        {m.vocabRotuloEn}
                        <Input value={editEn} onChange={(e) => setEditEn(e.target.value)} />
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        aria-busy={busy}
                        onClick={() => void handleSaveLabels(c.slug)}
                      >
                        {busy ? m.vocabSalvando : m.vocabSalvar}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(null)}
                      >
                        {m.vocabCancelar}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium text-fg">
                        {c.labelPtBr ?? c.slug}
                        {c.labelEnUs ? ` · ${c.labelEnUs}` : ''}
                      </span>
                      <span className="font-mono text-xs text-muted">{c.slug}</span>
                    </span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                      {statusLabel(c.status)}
                    </span>
                    <span className="ml-auto flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => startEdit(c)}
                      >
                        {m.vocabEditar}
                      </Button>
                      {c.status === 'active' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          aria-busy={busy}
                          onClick={() => void patch(c.slug, { status: 'deprecated' })}
                        >
                          {m.vocabDepreciar}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          aria-busy={busy}
                          onClick={() => void patch(c.slug, { status: 'active' })}
                        >
                          {m.vocabReativar}
                        </Button>
                      )}
                    </span>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
