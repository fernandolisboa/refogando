'use client'

/**
 * Modo cozinha (#455) — visão passo-a-passo em TELA CHEIA: tipografia grande, um passo em foco por
 * vez, check de "feito", `navigator.wakeLock` (a tela não apaga com a mão suja de farinha) e um
 * timer opcional por passo, PARSEADO DO TEXTO na hora (`parseStepTimer`, `@/domain/step-timer`).
 *
 * LANDMINE INEGOCIÁVEL (ADR-0023): tempo-por-passo é PROIBIDO como dado (schema/coluna nova) — o
 * timer é heurístico efêmero client-side sobre a STRING do passo já carregada, recalculado a cada
 * abertura, NUNCA persistido nem uma segunda fonte de verdade de tempo (que continua sendo só
 * `tempo_ativo_min`/`tempo_total_min`). Zero schema, zero IA, zero custo.
 *
 * A11y (mesmo padrão verbatim de `transcript-modal.tsx`): overlay `fixed inset-0 z-50`,
 * `role="dialog"` + `aria-modal`, Escape fecha, trap de Tab, captura/restaura foco do gatilho.
 * Setas ← → navegam entre passos (afordância extra, comum em apps de leitura passo-a-passo).
 */
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Timer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDuracao } from '@/domain/tempo'
import { parseStepTimer } from '@/domain/step-timer'
import type { Messages } from '@/i18n/messages'
import { cn } from '@/lib/utils'

export function RecipeCookMode({ passos, m }: { passos: string[]; m: Messages }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        {m.detalhe.modoCozinha}
      </Button>
      {open && <CookModeOverlay passos={passos} m={m} onClose={() => setOpen(false)} />}
    </>
  )
}

function CookModeOverlay({
  passos,
  m,
  onClose,
}: {
  passos: string[]
  m: Messages
  onClose: () => void
}) {
  const [stepIndex, setStepIndex] = useState(0)
  const [completed, setCompleted] = useState<ReadonlySet<number>>(new Set())
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  // A11y: captura o gatilho ao montar, foco entra no botão de fechar, restaura ao desmontar.
  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null
    closeBtnRef.current?.focus()
    const trigger = triggerRef.current
    return () => {
      trigger?.focus?.()
    }
  }, [])

  // wakeLock: pede ao ABRIR o modo cozinha, libera ao FECHAR. A spec libera automaticamente quando
  // a aba fica oculta (troca de app/bloqueio de tela) — reagimos a `visibilitychange` pra
  // readquirir quando o usuário volta, sem exigir fechar/reabrir o modo cozinha. Ausência da API
  // (`'wakeLock' in navigator` falso) ou falha (sem suporte real, bateria baixa em alguns
  // browsers) degrada SILENCIOSAMENTE — o modo cozinha funciona igual, só sem a tela ficar acesa.
  useEffect(() => {
    let cancelled = false
    async function requestLock() {
      if (!('wakeLock' in navigator)) return
      try {
        const sentinel = await navigator.wakeLock.request('screen')
        if (cancelled) {
          void sentinel.release()
          return
        }
        wakeLockRef.current = sentinel
      } catch {
        // Sem suporte real / negado pelo browser: degrada silenciosamente.
      }
    }
    void requestLock()
    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && wakeLockRef.current == null) {
        void requestLock()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      void wakeLockRef.current?.release()
      wakeLockRef.current = null
    }
  }, [])

  const total = passos.length
  const step = passos[stepIndex] ?? ''
  const timer = parseStepTimer(step)

  function goTo(i: number) {
    setStepIndex(Math.min(total - 1, Math.max(0, i)))
  }

  function toggleCompleted(i: number) {
    setCompleted((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={m.detalhe.modoCozinha}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
          return
        }
        if (e.key === 'ArrowRight') goTo(stepIndex + 1)
        if (e.key === 'ArrowLeft') goTo(stepIndex - 1)
        // Trap de Tab: mantém o foco dentro do diálogo (ciclo 1º ↔ último focável).
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
      className="fixed inset-0 z-50 flex flex-col gap-6 overflow-y-auto bg-bg p-6 sm:p-10"
    >
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-muted">
          {m.detalhe.modoCozinhaPassoDe
            .replace('{atual}', String(stepIndex + 1))
            .replace('{total}', String(total))}
        </p>
        {/* Alvo de toque MAIOR que o padrão (`size-12`, não `size-9`) — o modo cozinha é usado com
            "mão suja" (o próprio pitch da feature), então precisão de toque não pode ser assumida. */}
        <Button
          ref={closeBtnRef}
          type="button"
          variant="secondary"
          size="icon"
          className="size-12"
          aria-label={m.detalhe.modoCozinhaFechar}
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </div>

      {/* O passo em FOCO — tipografia grande, centralizada, é o coração do modo cozinha.
          `aria-live="polite"` anuncia a TROCA de passo pro leitor de tela (sem isto, navegar
          entre passos via teclado/toque não anuncia nada — achado de code-review). */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <p
          aria-live="polite"
          className="max-w-[40ch] text-pretty font-display text-3xl font-semibold leading-snug text-fg sm:text-4xl"
        >
          {step}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={completed.has(stepIndex)}
              onChange={() => toggleCompleted(stepIndex)}
              className="size-5 accent-brand"
            />
            {m.detalhe.modoCozinhaConcluir}
          </label>
          {/* `key={stepIndex}`: REMONTA ao trocar de passo. Sem isto, dois passos SEGUIDOS com
              timer reconhecido reusariam a MESMA instância (React reconcilia por posição/tipo) —
              o `setInterval` do passo anterior continuaria rodando e a UI mostraria a contagem
              do timer ERRADO até o usuário clicar "parar" manualmente (achado de code-review). */}
          {timer && <StepTimerButton key={stepIndex} minutes={timer.minutes} m={m} />}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <Button
          type="button"
          variant="outline"
          className="h-12 px-6 text-base"
          onClick={() => goTo(stepIndex - 1)}
          disabled={stepIndex === 0}
        >
          <ChevronLeft aria-hidden /> {m.detalhe.modoCozinhaAnterior}
        </Button>
        {/* Checkmark discreto no botão "Próximo" quando o passo corrente já foi marcado feito. */}
        <Button
          type="button"
          className="h-12 px-6 text-base"
          onClick={() => goTo(stepIndex + 1)}
          disabled={stepIndex >= total - 1}
        >
          {completed.has(stepIndex) && <Check aria-hidden className="size-4" />}
          {m.detalhe.modoCozinhaProximo} <ChevronRight aria-hidden />
        </Button>
      </div>
    </div>
  )
}

/**
 * Timer efêmero de UM passo — contagem regressiva puramente client-side (`setInterval`), nunca
 * persistida. Reinicia do zero sempre que `start()` é chamado (trocar de passo desmonta este
 * componente inteiro — `StepTimerButton` é remontado por `key` implícito de posição do React
 * quando `timer` deixa de existir/existe de novo entre passos, então o intervalo do passo anterior
 * já foi limpo pelo cleanup do efeito antes de qualquer novo passo montar o seu).
 */
function StepTimerButton({ minutes, m }: { minutes: number; m: Messages }) {
  const [remaining, setRemaining] = useState<number | null>(null) // segundos restantes
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(
    () => () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    },
    [],
  )

  function start() {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setRemaining(minutes * 60)
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r == null || r <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current)
          return 0
        }
        return r - 1
      })
    }, 1000)
  }

  function stop() {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = null
    setRemaining(null)
  }

  if (remaining == null) {
    return (
      <Button type="button" variant="secondary" onClick={start}>
        <Timer aria-hidden className="size-4" />
        {m.detalhe.modoCozinhaIniciarTimer.replace('{tempo}', formatDuracao(minutes))}
      </Button>
    )
  }

  const isDone = remaining === 0
  const mm = Math.floor(remaining / 60)
  const ss = remaining % 60
  const label = `${mm}:${String(ss).padStart(2, '0')}`

  return (
    <div className="flex items-center gap-2">
      {/* Contagem visual NÃO anunciada a cada segundo (spam de leitor de tela); só o desfecho
          "Tempo esgotado!" é anunciado, via o `role="status"` sr-only abaixo. */}
      <span
        className={cn(
          'font-display text-lg font-semibold tabular-nums',
          isDone ? 'text-destructive' : 'text-fg',
        )}
      >
        {isDone ? m.detalhe.modoCozinhaTempoEsgotado : label}
      </span>
      <span role="status" className="sr-only">
        {isDone ? m.detalhe.modoCozinhaTempoEsgotado : ''}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={stop}
        aria-label={m.detalhe.modoCozinhaPararTimer}
      >
        <X aria-hidden className="size-4" />
      </Button>
    </div>
  )
}
