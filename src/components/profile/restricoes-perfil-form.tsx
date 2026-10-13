'use client'
/**
 * Seção "Restrições alimentares" do `/me/profile` (ADR-0041). Separada do `ProfileForm` de propósito: aquele
 * edita o perfil (boa parte PÚBLICA — nome, bio, links); esta lista é PRIVADA e sensível, tem rota própria
 * (`/api/me/restricoes`, GET/PUT) e o seu próprio "Salvar". A cópia diz que só o dono vê.
 *
 * Fluxo: GET carrega a lista; os chips (checkbox) marcam/desmarcam; "Salvar" faz PUT e publica a lista nova
 * no contexto (`useAtualizarRestricoesPerfil`) — as superfícies abertas (drawer de criação, Cardápio, Busca)
 * passam a pré-marcar o novo default sem recarregar. Visitante: não renderiza nada (o `ProfileForm` acima já
 * mostra o convite de entrar). ADR-0010: route handler via fetch, nunca Server Action.
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { CheckboxChip } from '@/components/ui/checkbox-chip'
import { RESTRICOES, type Restricao } from '@/domain/vocabulary'
import { normalizarRestricoes, ordenarRestricoes } from '@/domain/restricoes-perfil'
import { useAtualizarRestricoesPerfil } from './restricoes-perfil-provider'

type Status = 'loading' | 'idle' | 'saving' | 'saved' | 'error' | 'load_failed'

export function RestricoesPerfilForm() {
  const { messages } = useLocale()
  const m = messages.restricoesPerfil
  const session = useSession()
  const authed = !session.isPending && !session.error && !!session.data
  const atualizarContexto = useAtualizarRestricoesPerfil()

  const [restricoes, setRestricoes] = useState<Restricao[]>([])
  const [status, setStatus] = useState<Status>('loading')

  // Incrementar re-dispara a carga ("Tentar de novo" depois de uma falha).
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    if (!authed) return
    const controller = new AbortController()
    void (async () => {
      try {
        const res = await fetch('/api/me/restricoes', { signal: controller.signal })
        if (!res.ok) {
          setStatus('load_failed')
          return
        }
        const body = (await res.json()) as { restricoes?: unknown }
        setRestricoes(normalizarRestricoes(body.restricoes))
        setStatus('idle')
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setStatus('load_failed')
      }
    })()
    return () => controller.abort()
  }, [authed, tentativa])

  function tentarDeNovo() {
    setStatus('loading')
    setTentativa((n) => n + 1)
  }

  function toggle(r: Restricao) {
    setStatus('idle')
    setRestricoes((prev) => ordenarRestricoes(prev.includes(r) ? prev.filter((v) => v !== r) : [...prev, r]))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (status === 'saving') return
    setStatus('saving')
    try {
      const res = await fetch('/api/me/restricoes', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ restricoes }),
      })
      if (!res.ok) {
        setStatus('error')
        return
      }
      const body = (await res.json()) as { restricoes?: unknown }
      const salvas = normalizarRestricoes(body.restricoes)
      setRestricoes(salvas)
      atualizarContexto(salvas)
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  if (!authed) return null

  return (
    <section aria-labelledby="restricoes-perfil-titulo" className="flex max-w-xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="restricoes-perfil-titulo" className="font-display text-xl font-semibold tracking-tight text-fg">
          {m.titulo}
        </h2>
        <p className="text-sm text-muted">{m.descricao}</p>
        <p className="text-sm font-medium text-fg">{m.privado}</p>
      </div>

      {status === 'loading' ? (
        <div aria-busy="true" className="text-muted">
          {messages.system.loading}
        </div>
      ) : status === 'load_failed' ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-sm font-medium text-fg">
            {m.erroCarregar}
          </p>
          <Button type="button" variant="secondary" onClick={tentarDeNovo}>
            {messages.system.retry}
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <fieldset
            className="flex flex-col gap-2"
            disabled={status === 'saving'}
            aria-describedby="restricoes-perfil-aviso"
          >
            <legend className="mb-1 text-sm font-medium text-fg">{m.legenda}</legend>
            <div className="flex flex-wrap gap-2">
              {RESTRICOES.map((r) => (
                <CheckboxChip key={r} checked={restricoes.includes(r)} onChange={() => toggle(r)}>
                  {messages.restricaoLabel[r]}
                </CheckboxChip>
              ))}
            </div>
            <p id="restricoes-perfil-aviso" className="text-xs text-muted">
              {m.aviso}
            </p>
          </fieldset>
          {/* Dado sensível (LGPD Art. 11): o propósito e como apagar ficam DESTACADOS junto do salvar — e o
              botão aponta para o texto, então o leitor de tela o ouve no momento de consentir. */}
          <p id="restricoes-perfil-consentimento" className="text-xs text-fg">
            {m.consentimento}
          </p>
          <div>
            <Button
              type="submit"
              variant="secondary"
              disabled={status === 'saving'}
              aria-describedby="restricoes-perfil-consentimento"
            >
              {status === 'saving' ? m.salvando : m.salvar}
            </Button>
          </div>
        </form>
      )}

      {/* Região viva sempre no DOM (anuncia o desfecho do salvar). */}
      <div aria-live="polite" className="text-sm">
        {status === 'saved' && <p className="font-medium text-fg">{m.salvo}</p>}
        {status === 'error' && (
          <p role="alert" className="font-medium text-fg">
            {m.erro}
          </p>
        )}
      </div>
    </section>
  )
}
