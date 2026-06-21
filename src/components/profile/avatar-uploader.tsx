'use client'
/**
 * Controle de avatar (#126, frente Perfil) — sobe/troca/remove a foto de perfil. Espelha a
 * disciplina do `ProfileForm`: guard de sessão no client (Visitante não tem avatar pra editar);
 * fala com o ROUTE HANDLER (`/api/me/avatar`) via `fetch` (nunca Server Action — ADR-0010).
 *
 * Fluxo de upload: escolhe arquivo → valida tipo no client → REDIMENSIONA no client (`resizeImage`,
 * pra ficar abaixo do limite de body da Vercel) → POST multipart. Em sucesso, reflete a nova URL
 * localmente E chama `refetch()` da sessão (o atom é compartilhado: o avatar do header — também
 * `useSession` — atualiza junto). Remover = DELETE. O servidor é a fonte de verdade da validação
 * (tipo/tamanho) e da posse (só o dono, e só apaga o blob que foi nosso).
 *
 * Lê o avatar atual de `useSession().data.user.image` (sem GET extra): a sessão já carrega `image`.
 */
import { useRef, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { resizeImage } from '@/lib/image-resize'
import { Avatar } from '@/components/profile/avatar'
import { Button } from '@/components/ui/button'

/** Formatos aceitos (espelha a allowlist do servidor); o input filtra e o servidor reforça. */
const ACCEPT = 'image/jpeg,image/png,image/webp'
/** Cap de tamanho (2 MB) — espelha MAX_BYTES da rota; barra cedo um arquivo grande pós-resize. */
const MAX_BYTES = 2 * 1024 * 1024

type Status = 'idle' | 'busy'
/** Erro inline específico (≠ silêncio): tipo recusado, grande demais, ou falha de envio. */
type UploadError = null | 'tipo' | 'grande' | 'falha'

/** Extensão de arquivo do blob redimensionado (pro nome no FormData; o servidor lê o `type`). */
function extFor(type: string): string {
  if (type === 'image/png') return 'png'
  if (type === 'image/jpeg') return 'jpg'
  return 'webp'
}

export function AvatarUploader() {
  const { messages } = useLocale()
  const m = messages.perfil
  const session = useSession()
  const authed = !session.isPending && !session.error && !!session.data
  const user = session.data?.user
  const name = user?.name || user?.email || ''

  // `image === undefined` ⇒ ainda não mexemos: usa o valor da sessão. Após upload/remoção, fixamos
  // localmente (a sessão sincroniza via refetch, mas o estado local dá feedback imediato).
  const [image, setImage] = useState<string | null | undefined>(undefined)
  const current = image === undefined ? (user?.image ?? null) : image
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<UploadError>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)

    if (!ACCEPT.split(',').includes(file.type)) {
      setError('tipo')
      resetInput()
      return
    }

    setStatus('busy')
    try {
      const blob = await resizeImage(file)
      if (blob.size > MAX_BYTES) {
        setError('grande')
        setStatus('idle')
        return
      }
      const fd = new FormData()
      fd.append('file', blob, `avatar.${extFor(blob.type)}`)
      const res = await fetch('/api/me/avatar', { method: 'POST', body: fd })
      if (!res.ok) {
        setError('falha')
        setStatus('idle')
        return
      }
      const body = (await res.json()) as { image: string }
      setImage(body.image)
      setStatus('idle')
      await session.refetch?.()
    } catch {
      setError('falha')
      setStatus('idle')
    } finally {
      resetInput()
    }
  }

  async function onRemove() {
    setError(null)
    setStatus('busy')
    try {
      const res = await fetch('/api/me/avatar', { method: 'DELETE' })
      if (!res.ok) {
        setError('falha')
        setStatus('idle')
        return
      }
      setImage(null)
      setStatus('idle')
      await session.refetch?.()
    } catch {
      setError('falha')
      setStatus('idle')
    }
  }

  /** Limpa o value do input pra permitir re-selecionar o MESMO arquivo (onChange só dispara se muda). */
  function resetInput() {
    if (fileRef.current) fileRef.current.value = ''
  }

  // Visitante não tem avatar pra editar (server-side requireSession é a barreira real; isto é chrome).
  if (!authed) return null

  const busy = status === 'busy'

  return (
    <div className="flex items-center gap-4">
      <Avatar src={current} name={name} alt={m.avatarAlt.replace('{name}', name)} size="lg" />

      <div className="flex flex-col items-start gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <label
              // Durante o envio, o affordance casa o estado real: cursor/eventos desligados +
              // opacidade (o <input disabled> já bloqueia o clique; isto é só coerência visual).
              className={busy ? 'cursor-not-allowed opacity-70 pointer-events-none' : 'cursor-pointer'}
            >
              {busy ? m.avatarEnviando : current ? m.avatarTrocar : m.avatarEnviar}
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPT}
                onChange={onPick}
                disabled={busy}
                className="sr-only"
              />
            </label>
          </Button>
          {current && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onRemove}
              disabled={busy}
            >
              {m.avatarRemover}
            </Button>
          )}
        </div>

        <div aria-live="polite" className="text-xs">
          {error === 'tipo' && (
            <p role="alert" className="font-medium text-fg">
              {m.avatarTipoInvalido}
            </p>
          )}
          {error === 'grande' && (
            <p role="alert" className="font-medium text-fg">
              {m.avatarGrande}
            </p>
          )}
          {error === 'falha' && (
            <p role="alert" className="font-medium text-fg">
              {m.avatarErro}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
