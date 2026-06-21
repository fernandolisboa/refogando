'use client'
/**
 * Transcrição COMPLETA em modal read-only (#104 S3) — o Modo Conversa unificado é uma VISTA
 * FOCADA (só o último par de falas + a Receita herói), então o histórico inteiro fica atrás
 * de "Ver transcrição". Este componente é PURO: sem estado próprio além das refs de foco, sem
 * `fetch`, sem locale — recebe o transcript já carregado e os rótulos já localizados.
 *
 * A11y (mesmo padrão verbatim do diálogo de apagar em conversation-experience.tsx): overlay
 * `fixed inset-0 z-50`, `role="dialog"` + `aria-modal`, Escape fecha, trap de Tab dentro do
 * diálogo, e — ao MONTAR — captura o elemento ativo (o gatilho) para devolver-lhe o foco no
 * `onClose`. O caller só precisa des-renderizar o modal dentro do seu `onClose`.
 */
import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import type { ChatMessage } from '@/hooks/use-conversation-chat'

export function TranscriptModal({
  transcript,
  titulo,
  closeLabel,
  voceLabel,
  assistenteLabel,
  onClose,
}: {
  transcript: ChatMessage[]
  titulo: string
  closeLabel: string
  voceLabel: string
  assistenteLabel: string
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)
  // Elemento que tinha o foco quando o modal abriu (o gatilho "Ver transcrição") — capturado no
  // mount e restaurado ao fechar, para o foco do teclado não cair no <body> atrás do overlay.
  const triggerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null
    // Foco entra no botão de fechar (1º controle focável) ao abrir.
    closeBtnRef.current?.focus()
    const trigger = triggerRef.current
    return () => {
      // Restaura o foco ao gatilho ao desmontar (fechar). Guard de existência: o gatilho pode
      // ter saído do DOM (improvável aqui, mas barato e defensivo).
      trigger?.focus?.()
    }
    // Só na montagem/desmontagem (captura/restaura uma vez); refs são estáveis.
  }, [])

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="transcricao-titulo"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
          return
        }
        // Trap de Tab: mantém o foco dentro do diálogo (ciclo 1º ↔ último focável). Sem isso o
        // Tab vaza para o conteúdo atrás do overlay.
        if (e.key === 'Tab') {
          const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          )
          if (!focusables || focusables.length === 0) return
          const first = focusables[0]
          const last = focusables[focusables.length - 1]
          const active = document.activeElement
          if (e.shiftKey && active === first) {
            e.preventDefault()
            last.focus()
          } else if (!e.shiftKey && active === last) {
            e.preventDefault()
            first.focus()
          }
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-fg/40 p-4"
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 rounded-md border border-border bg-bg p-5 shadow-lg">
        <div className="flex items-center justify-between gap-4">
          <h2 id="transcricao-titulo" className="font-display text-lg font-semibold text-fg">
            {titulo}
          </h2>
          <Button ref={closeBtnRef} type="button" variant="secondary" onClick={onClose}>
            {closeLabel}
          </Button>
        </div>

        {/* Histórico completo, rolável. Cada fala rotulada pelo papel (Você / IA). */}
        <ol className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          {transcript.map((msg, i) => (
            <li
              key={i}
              className={
                msg.role === 'user'
                  ? 'self-end max-w-[85%] rounded-md rounded-br-none border border-border bg-surface px-4 py-2.5'
                  : 'self-start max-w-[85%] rounded-md rounded-bl-none border border-border bg-bg px-4 py-2.5'
              }
            >
              <p className="text-xs font-medium text-muted">
                {msg.role === 'user' ? voceLabel : assistenteLabel}
              </p>
              <p className="whitespace-pre-wrap text-pretty text-fg">{msg.content}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
