'use client'

/**
 * Conceder/reverter o PLANO comercial de um usuário (Fase 2 de billing, #466) — Admin-only (a page
 * `/admin/plano` revalida `min='admin'` server-side; a API `/api/admin/user-plan` reforça
 * `requireRole 'admin'`). Concessão MANUAL de `pro` (concierge): o admin digita `@handle` OU email e
 * escolhe Pro/Free. NÃO cobra nada — o billing real ainda não está ligado; é a única forma de marcar
 * alguém como `pro` por ora.
 *
 * ADR-0010: consome o ROUTE HANDLER `POST /api/admin/user-plan` via `fetch` (a resolução por
 * handle/email + a validação do plano moram no servidor). O corpo devolve o usuário RESOLVIDO com o
 * plano ATUAL (pós-gravação), que a UI mostra pra confirmar o estado. Discriminação de erro por CHAVE
 * `{error}`, nunca por status: `usuario_nao_encontrado` → não achou; `plano_invalido` → plano fora de
 * PLANS; qualquer outra não-ok → `erroGenerico`. Cores: só tokens AA-verificados (#54).
 */
import { useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Plan } from '@/domain/plan'

type ResolvedUser = { name: string; handle: string; email: string | null; plan: Plan }

export function UserPlanSection() {
  const { messages } = useLocale()
  const m = messages.admin

  const [identifier, setIdentifier] = useState('')
  const [pending, setPending] = useState<Plan | null>(null)
  const [resolved, setResolved] = useState<ResolvedUser | null>(null)
  const [errorKey, setErrorKey] = useState<
    'erroNaoEncontrado' | 'erroPlanoInvalido' | 'erroGenerico' | null
  >(null)

  const planLabel: Record<Plan, string> = { free: m.planoPlanoFree, pro: m.planoPlanoPro }

  async function apply(plan: Plan) {
    if (pending) return
    const id = identifier.trim()
    if (id === '') {
      setErrorKey('erroGenerico')
      setResolved(null)
      return
    }
    setPending(plan)
    setErrorKey(null)
    setResolved(null)
    try {
      const res = await fetch('/api/admin/user-plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: id, plan }),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null
        setErrorKey(
          b?.error === 'usuario_nao_encontrado'
            ? 'erroNaoEncontrado'
            : b?.error === 'plano_invalido'
              ? 'erroPlanoInvalido'
              : 'erroGenerico',
        )
        return
      }
      const b = (await res.json()) as { user: ResolvedUser }
      setResolved(b.user)
    } catch {
      setErrorKey('erroGenerico')
    } finally {
      setPending(null)
    }
  }

  return (
    <section aria-labelledby="plano-conceder-titulo" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="plano-conceder-titulo" className="font-display text-lg font-semibold text-fg">
          {m.planoConcederTitulo}
        </h2>
        <p className="max-w-[60ch] text-sm text-muted">{m.planoConcederDescricao}</p>
      </div>

      <label className="flex max-w-md flex-col gap-1 text-sm font-medium text-fg">
        {m.planoIdentificadorLabel}
        <Input
          type="text"
          value={identifier}
          onChange={(e) => {
            setIdentifier(e.target.value)
            setResolved(null)
            setErrorKey(null)
          }}
          placeholder={m.planoIdentificadorPlaceholder}
          autoComplete="off"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void apply('pro')}
          disabled={pending !== null}
          aria-busy={pending === 'pro'}
        >
          {pending === 'pro' ? m.planoAplicando : m.planoBotaoPro}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void apply('free')}
          disabled={pending !== null}
          aria-busy={pending === 'free'}
        >
          {pending === 'free' ? m.planoAplicando : m.planoBotaoFree}
        </Button>
      </div>

      {resolved && (
        <p role="status" aria-live="polite" className="text-sm font-medium text-brand-ink">
          {m.planoSucesso
            .replace('{user}', `${resolved.name} (@${resolved.handle})`)
            .replace('{plano}', planLabel[resolved.plan])}
        </p>
      )}
      {errorKey && (
        <p
          role="alert"
          className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
        >
          {errorKey === 'erroNaoEncontrado'
            ? m.planoErroNaoEncontrado
            : errorKey === 'erroPlanoInvalido'
              ? m.planoErroPlanoInvalido
              : m.erroGenerico}
        </p>
      )}
    </section>
  )
}
