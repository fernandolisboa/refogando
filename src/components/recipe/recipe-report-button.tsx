'use client'
/**
 * "Reportar" na página da Receita (#605) — denúncia de uma Receita pública ou de catálogo por quem tem conta e não
 * é o dono (o `RecipeDetailActions` só monta no ramo logado e não-dono). Mesmo molde do "Reportar" das avaliações
 * (`recipe-review-section`, #366): o botão revela o motivo (obrigatório; o servidor reimpõe 400), e o form o
 * SUBSTITUI com "Enviar denúncia" + "Cancelar". Sucesso ⇒ "Denúncia enviada" fixo (a mesma pessoa reenviar devolve
 * a denúncia pendente, sem linha nova). Nenhuma ação de remover: só o Curador remove, na fila do painel.
 *
 * Desfechos: 201 ⇒ enviada; 429 `limite_denuncias` (teto diário por conta) ⇒ mensagem própria; 404 (a receita
 * saiu do pool no meio) ⇒ "não está mais disponível"; 401 (a sessão caiu) ⇒ pede para entrar de novo; qualquer
 * outra coisa (rede fora, 5xx) ⇒ erro neutro, e dá para tentar de novo. Foco: o motivo ao abrir, o botão
 * "Reportar" de volta ao cancelar e a confirmação ao enviar (o form some; o foco não cai no `body`).
 * ADR-0010: route handler via fetch, nunca Server Action.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { REPORT_REASON_MAX } from '@/domain/report'

type Estado = 'fechado' | 'aberto' | 'enviando' | 'enviada'
type Erro = null | 'falha' | 'limite' | 'indisponivel' | 'sessao'

function erroDoStatus(status: number): Exclude<Erro, null> {
  if (status === 429) return 'limite'
  if (status === 404) return 'indisponivel'
  if (status === 401) return 'sessao'
  return 'falha'
}

export function RecipeReportButton({ recipeId }: { recipeId: string }) {
  const { messages } = useLocale()
  const m = messages.denunciaReceita
  const id = useId()
  const [estado, setEstado] = useState<Estado>('fechado')
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<Erro>(null)
  // Para onde o foco vai depois da troca de estado: o gatilho (cancelou) ou a confirmação (enviou).
  const focoPendente = useRef<'gatilho' | 'confirmacao' | null>(null)
  const gatilhoRef = useRef<HTMLButtonElement>(null)
  const confirmacaoRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const alvo = focoPendente.current
    if (alvo === null) return
    focoPendente.current = null
    if (alvo === 'gatilho') gatilhoRef.current?.focus()
    else confirmacaoRef.current?.focus()
  }, [estado])

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
        focoPendente.current = 'confirmacao'
        setEstado('enviada')
        return
      }
      setErro(erroDoStatus(res.status))
    } catch {
      setErro('falha')
    }
    setEstado('aberto')
  }

  if (estado === 'enviada') {
    return (
      <p ref={confirmacaoRef} tabIndex={-1} role="status" className="text-sm text-muted outline-none">
        {m.enviada}
      </p>
    )
  }

  if (estado === 'fechado') {
    return (
      <div>
        <Button
          ref={gatilhoRef}
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
        maxLength={REPORT_REASON_MAX}
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
            focoPendente.current = 'gatilho'
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
            {erro === 'limite'
              ? m.erroLimite
              : erro === 'indisponivel'
                ? m.erroIndisponivel
                : erro === 'sessao'
                  ? m.erroSessao
                  : m.erro}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
