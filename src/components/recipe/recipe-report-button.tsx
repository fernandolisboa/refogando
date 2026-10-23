'use client'
/**
 * "Reportar" na página da Receita (#605) — denúncia de uma Receita pública ou de catálogo por quem tem conta e não
 * é o dono (o `RecipeDetailActions` só monta no ramo logado e não-dono). Mesmo molde do "Reportar" das avaliações
 * (`recipe-review-section`, #366): o botão revela o motivo (obrigatório; o servidor reimpõe 400), e o form o
 * SUBSTITUI com "Enviar denúncia" + "Cancelar". Sucesso ⇒ "Denúncia enviada" fixo (a mesma pessoa reenviar devolve
 * a denúncia pendente, sem linha nova). Nenhuma ação de remover: só o Curador remove, na fila do painel.
 *
 * Desfechos: 201 ⇒ enviada; 429 `limite_denuncias` (teto diário por conta) ⇒ mensagem própria; qualquer outra
 * coisa (404 da receita que saiu do pool no meio, rede fora) ⇒ erro neutro, e dá para tentar de novo.
 * ADR-0010: route handler via fetch, nunca Server Action.
 */
import { useId, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/** Teto do motivo no cliente: um motivo cabe com folga; evita colar um texto enorme na fila. */
const MOTIVO_MAX = 1000

type Estado = 'fechado' | 'aberto' | 'enviando' | 'enviada'
type Erro = null | 'falha' | 'limite'

export function RecipeReportButton({ recipeId }: { recipeId: string }) {
  const { messages } = useLocale()
  const m = messages.denunciaReceita
  const id = useId()
  const [estado, setEstado] = useState<Estado>('fechado')
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<Erro>(null)

  async function enviar() {
    const reason = motivo.trim()
    if (estado === 'enviando' || reason.length === 0) return
    setEstado('enviando')
    setErro(null)
    try {
      const res = await fetch(`/api/recipes/${recipeId}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (res.ok) {
        setEstado('enviada')
        return
      }
      setErro(res.status === 429 ? 'limite' : 'falha')
    } catch {
      setErro('falha')
    }
    setEstado('aberto')
  }

  if (estado === 'enviada') {
    return (
      <p role="status" className="text-sm text-muted">
        {m.enviada}
      </p>
    )
  }

  if (estado === 'fechado') {
    return (
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setErro(null)
            setEstado('aberto')
          }}
        >
          {m.reportar}
        </Button>
      </div>
    )
  }

  const enviando = estado === 'enviando'
  return (
    <div className="flex max-w-xl flex-col gap-2">
      <Label htmlFor={`${id}-motivo`}>{m.motivo}</Label>
      <p id={`${id}-dica`} className="text-xs text-muted">
        {m.dica}
      </p>
      <Textarea
        id={`${id}-motivo`}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        rows={3}
        maxLength={MOTIVO_MAX}
        aria-required="true"
        aria-describedby={`${id}-dica`}
        disabled={enviando}
        autoFocus
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void enviar()}
          disabled={enviando || motivo.trim().length === 0}
          aria-busy={enviando}
        >
          {enviando ? m.enviando : m.enviar}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            setEstado('fechado')
            setErro(null)
          }}
          disabled={enviando}
        >
          {m.cancelar}
        </Button>
      </div>
      {erro !== null && (
        <Alert variant="info" role="alert">
          <AlertDescription className="font-medium text-foreground">
            {erro === 'limite' ? m.erroLimite : m.erro}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
