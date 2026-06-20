'use client'
/**
 * Formulário de edição de perfil (#124, frente Perfil — primeira fatia: nome + bio). Espelha a
 * disciplina do `MyRecipesList` (guard de sessão no client; só busca depois que a sessão resolveu)
 * e do `RecipeEditForm` (consome o ROUTE HANDLER via `fetch`, nunca Server Action — ADR-0010).
 *
 * Fluxo: ao montar, GET /api/me carrega { name, email, bio, handle } nos campos. `email` é
 * READ-ONLY (identidade) — input disabled, nunca enviado. Ao salvar, PATCH /api/me com
 * { name, bio, handle }; o form reflete os valores retornados e mostra "Perfil salvo." (live
 * region). Erros genéricos do servidor NUNCA vazam a mensagem crua — só a chave `perfil.erro`.
 *
 * Handle (#128): editável, com FEEDBACK INLINE específico. Os códigos de erro da rota
 * (handle_taken / handle_reserved / handle_invalid) mapeiam para mensagens traduzidas
 * embaixo do campo — o usuário sabe exatamente por que o handle foi recusado (≠ erro genérico).
 *
 * Owner-only de verdade é server-side (`requireSession` na rota); aqui o guard é só afordância de
 * chrome (Visitante vê o convite de entrar, não o form).
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { btnPrimary, fieldClassName } from '@/components/button'

type Status = 'loading' | 'idle' | 'saving' | 'saved' | 'error'
type Profile = { id: string; name: string; email: string; bio: string | null; handle: string }
/** Erro específico do handle, traduzível inline (≠ erro genérico do form). */
type HandleError = 'taken' | 'reserved' | 'invalid' | null

const BIO_MAX_LEN = 280

/** Mapeia o `error` do PATCH /api/me para o erro inline de handle (ou null se não for de handle). */
function handleErrorFor(code: string | undefined): HandleError {
  switch (code) {
    case 'handle_taken':
      return 'taken'
    case 'handle_reserved':
      return 'reserved'
    case 'handle_invalid':
      return 'invalid'
    default:
      return null
  }
}

export function ProfileForm() {
  const { messages } = useLocale()
  const m = messages.perfil
  const session = useSession()
  // Visitante só busca depois que a sessão resolveu E está logado (sem disparar um 401 inútil).
  const authed = !session.isPending && !session.error && !!session.data

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [handle, setHandle] = useState('')
  const [handleError, setHandleError] = useState<HandleError>(null)
  const [status, setStatus] = useState<Status>('loading')

  // Carrega o perfil ao montar (só logado). AbortController cancela no unmount.
  useEffect(() => {
    if (!authed) return
    const controller = new AbortController()
    void (async () => {
      try {
        setStatus('loading')
        const res = await fetch('/api/me', { signal: controller.signal })
        if (!res.ok) {
          setStatus('error')
          return
        }
        const p = (await res.json()) as Profile
        setEmail(p.email)
        setName(p.name)
        setBio(p.bio ?? '')
        setHandle(p.handle)
        setStatus('idle')
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setStatus('error')
      }
    })()
    return () => controller.abort()
  }, [authed])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving')
    setHandleError(null)
    try {
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, bio, handle }),
      })
      if (!res.ok) {
        // Distingue um erro DE HANDLE (feedback inline específico) de um erro genérico.
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        const he = handleErrorFor(body.error)
        if (he) {
          setHandleError(he)
          setStatus('idle') // erro de campo, não falha global do form
        } else {
          setStatus('error')
        }
        return
      }
      const p = (await res.json()) as Profile
      // Reflete os valores canônicos retornados pelo servidor (name trimado, bio vazia → null,
      // handle normalizado pra minúsculas).
      setName(p.name)
      setBio(p.bio ?? '')
      setHandle(p.handle)
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  // ── Guard de sessão (Visitante não tem perfil pra editar) ───────────────────
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
        <Link href="/sign-in" className={btnPrimary}>
          {messages.nav.signIn}
        </Link>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div aria-busy="true" className="text-muted">
        {messages.system.loading}
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="profile-name" className="text-sm font-medium text-fg">
          {m.nome}
        </label>
        <input
          id="profile-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className={fieldClassName}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="profile-handle" className="text-sm font-medium text-fg">
          {m.handle}
        </label>
        <input
          id="profile-handle"
          type="text"
          value={handle}
          onChange={(e) => {
            setHandle(e.target.value)
            setHandleError(null) // limpa o erro ao editar (feedback some quando o usuário corrige)
          }}
          required
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={handleError !== null}
          aria-describedby={handleError ? 'profile-handle-error' : 'profile-handle-hint'}
          className={fieldClassName}
        />
        {handleError ? (
          <p id="profile-handle-error" role="alert" className="text-xs font-medium text-fg">
            {handleError === 'taken' && m.handleEmUso}
            {handleError === 'reserved' && m.handleReservado}
            {handleError === 'invalid' && m.handleInvalido}
          </p>
        ) : (
          <p id="profile-handle-hint" className="text-xs text-muted">
            {m.handleDica.replace('{handle}', handle || m.handlePlaceholder)}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="profile-email" className="text-sm font-medium text-fg">
          {m.email}
        </label>
        <input
          id="profile-email"
          type="email"
          value={email}
          disabled
          readOnly
          className={`${fieldClassName} cursor-not-allowed opacity-70`}
        />
        <p className="text-xs text-muted">{m.emailDica}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="profile-bio" className="text-sm font-medium text-fg">
          {m.bio}
        </label>
        <textarea
          id="profile-bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={BIO_MAX_LEN}
          rows={4}
          placeholder={m.bioPlaceholder}
          className={`${fieldClassName} resize-y`}
        />
        <p className="self-end text-xs text-muted">{m.bioContador.replace('{n}', String(bio.length))}</p>
      </div>

      <div className="flex items-center gap-4">
        <button type="submit" disabled={status === 'saving'} className={btnPrimary}>
          {status === 'saving' ? m.salvando : m.salvar}
        </button>
      </div>

      {/* Live region: mensagens efêmeras curtas (sucesso/erro). */}
      <div aria-live="polite" className="text-sm">
        {status === 'saved' && <p className="font-medium text-fg">{m.salvo}</p>}
        {status === 'error' && (
          <p role="alert" className="font-medium text-fg">
            {m.erro}
          </p>
        )}
      </div>
    </form>
  )
}
