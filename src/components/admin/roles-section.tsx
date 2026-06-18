'use client'

/**
 * Definir papel de usuário (#63, AC1) — Admin-only (o `AdminConsole` só a monta para
 * `role==='admin'`; o servidor reforça com requireRole 'admin'). A ação é GENÉRICA de
 * set-role: o select inclui `usuario` (ROLES[0]), então PROMOVE e REBAIXA (admin→usuário);
 * por isso o rótulo do botão é neutro (`aplicarPapel`/`aplicandoPapel`), não "Promover", e
 * a mensagem de sucesso é neutra ("Papel atualizado.").
 *
 * ADR-0010: consome `PUT /api/admin/roles` via `fetch` (NÃO Server Action). O backend recebe
 * `userId` (não email — busca por email é polish), então o rótulo é honesto: "ID do usuário".
 *
 * Discriminação de erro por CHAVE do corpo `{error}`, NUNCA por status (a rota pode devolver
 * `papel_invalido` E `papel_nao_aplicado` ambos com status 400): `papel_invalido` → papel
 * fora de ROLES; `papel_nao_aplicado` → não deu para aplicar (ex.: ID inexistente); qualquer
 * outra não-ok → `erroGenerico`. Cores: só neutros/brand AA-verificados; sem âmbar/accent.
 */
import { useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { btnPrimarySm, fieldClassName } from '@/components/button'
import { ROLES, type Role } from '@/domain/user'

export function RolesSection() {
  const { messages } = useLocale()
  const m = messages.admin

  const [userId, setUserId] = useState('')
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

  const podeEnviar = userId.trim().length > 0 && !saving

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!podeEnviar) return
    setSaving(true)
    setStatus('idle')
    setErrorKey(null)
    try {
      const res = await fetch('/api/admin/roles', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: userId.trim(), role }),
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

  return (
    <section aria-labelledby="papeis-titulo" className="flex flex-col gap-3">
      <h2 id="papeis-titulo" className="font-display text-lg font-semibold text-fg">
        {m.papeisTitulo}
      </h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-fg">
          {m.userIdLabel}
          <input
            type="text"
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value)
              setStatus('idle')
            }}
            placeholder={m.userIdPlaceholder}
            className={fieldClassName}
          />
        </label>
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
        <button
          type="submit"
          disabled={!podeEnviar}
          aria-busy={saving}
          className={`${btnPrimarySm} disabled:opacity-70`}
        >
          {saving ? m.aplicandoPapel : m.aplicarPapel}
        </button>
      </form>

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
