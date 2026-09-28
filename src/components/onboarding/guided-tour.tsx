'use client'
/**
 * Tour guiado (ADR-0039): escurece a tela, destaca UM componente da chrome por passo e explica o que
 * ele faz. Montado UMA vez no layout (persiste entre navegações) e só abre na home, onde os alvos
 * existem.
 *
 * Abre sozinho uma vez para conta nova (regra em `shouldAutoStartTour`) e sempre que alguém pede pela
 * página /guia (`requestTourStart`). Dispensável em qualquer passo: "Pular tour", o X e o Esc fecham e
 * gravam `dismissed`; chegar ao fim grava `done`. Os dois encerram a abertura automática NAQUELE
 * dispositivo (localStorage, sem migração: ADR-0039 dec.3).
 *
 * a11y: é um Radix Dialog modal (foco preso no cartão, Esc fecha, o resto da página fica inerte e
 * `aria-hidden`); o título e o texto do passo são o nome e a descrição acessíveis. O destaque é só
 * visual. Clicar fora NÃO fecha (um clique sem querer não perde o tour); para sair há três caminhos
 * explícitos.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Dialog } from 'radix-ui'
import { XIcon } from 'lucide-react'
import { useLocale } from '@/i18n/provider'
import { splitLocalePrefix } from '@/i18n/locale-path'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { consumeTourStartRequest, TOUR_START_EVENT } from '@/components/onboarding/tour-signal'
import {
  parseTourState,
  placeTourCard,
  resolveAnchor,
  shouldAutoStartTour,
  tourStepsFor,
  tourStorageKey,
  type Rect,
  type TourAnchor,
  type TourState,
  type TourStep,
} from '@/domain/onboarding-tour'
import type { Messages } from '@/i18n/messages'

/** Espera a home assentar (busca, sessão, fontes) antes de abrir sozinho. */
const AUTO_START_DELAY_MS = 600
/** Folga do destaque em volta do alvo. */
const SPOTLIGHT_PAD = 6

/** `undefined` = storage ilegível (modo privado/bloqueado): `shouldAutoStartTour` não abre nesse caso. */
function readTourState(userId: string): TourState | null | undefined {
  try {
    return parseTourState(window.localStorage.getItem(tourStorageKey(userId)))
  } catch {
    return undefined
  }
}

function writeTourState(userId: string, state: TourState): void {
  try {
    window.localStorage.setItem(tourStorageKey(userId), state)
  } catch {
    // Sem storage não há memória; o tour só volta a abrir sozinho se o storage voltar a funcionar.
  }
}

/** O elemento visível da âncora (a nav do desktop some no celular; o drawer só existe aberto). */
function findAnchor(anchor: TourAnchor): HTMLElement | null {
  const els = document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`)
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (el.getClientRects().length > 0 && r.width > 0 && r.height > 0) return el
  }
  return null
}

function stepCopy(step: TourStep, t: Messages['tour'], authed: boolean): { title: string; body: string } {
  switch (step.id) {
    case 'boasVindas':
      return { title: t.boasVindasTitulo, body: t.boasVindasTexto }
    case 'busca':
      return { title: t.buscaTitulo, body: t.buscaTexto }
    case 'criar':
      return { title: t.criarTitulo, body: t.criarTexto }
    case 'salvos':
      return { title: t.salvosTitulo, body: t.salvosTexto }
    case 'cardapio':
      return { title: t.cardapioTitulo, body: t.cardapioTexto }
    case 'conta':
      return { title: t.contaTitulo, body: authed ? t.contaTexto : t.contaTextoVisitante }
    case 'fim':
      return { title: t.fimTitulo, body: t.fimTexto }
  }
}

export function GuidedTour() {
  const session = useSession()
  const pathname = usePathname()
  const onHome = splitLocalePrefix(pathname ?? '/').rest === '/'
  const authed = !session.isPending && !session.error && !!session.data
  const userId = authed ? session.data?.user.id ?? null : null
  const createdAt = authed ? (session.data?.user as { createdAt?: Date | string } | undefined)?.createdAt : undefined

  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  // Uma checagem automática por usuário por carga da página: navegar de volta à home não reabre.
  const autoCheckedFor = useRef<string | null>(null)

  const start = useCallback(() => {
    setIndex(0)
    setOpen(true)
  }, [])

  // Pedido explícito (botão da /guia): consome ao chegar na home, ou na hora se já estiver nela.
  useEffect(() => {
    if (!onHome || session.isPending) return
    const tryStart = () => {
      if (consumeTourStartRequest()) start()
    }
    tryStart()
    window.addEventListener(TOUR_START_EVENT, tryStart)
    return () => window.removeEventListener(TOUR_START_EVENT, tryStart)
  }, [onHome, session.isPending, start])

  // Abertura automática para conta nova. Marca a checagem SÓ quando o timer dispara: se o efeito
  // re-rodar antes (a sessão é re-buscada ao navegar), o timer é só re-agendado, nunca perdido.
  useEffect(() => {
    if (!userId || !onHome || open || autoCheckedFor.current === userId) return
    const timer = window.setTimeout(() => {
      autoCheckedFor.current = userId
      const ok = shouldAutoStartTour({
        authed: true,
        onHome: true,
        createdAt,
        now: Date.now(),
        stored: readTourState(userId),
      })
      if (ok) start()
    }, AUTO_START_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [userId, onHome, open, createdAt, start])

  const close = useCallback(
    (state: TourState) => {
      setOpen(false)
      if (!userId) return
      // Terminar vale mais que pular: um "pular" depois de já ter terminado não rebaixa o registro.
      if (state === 'dismissed' && readTourState(userId) === 'done') return
      writeTourState(userId, state)
    },
    [userId],
  )

  if (!open) return null
  const steps = tourStepsFor(authed)
  const i = Math.min(index, steps.length - 1)
  return (
    <TourCard
      steps={steps}
      index={i}
      authed={authed}
      onNext={() => setIndex(i + 1)}
      onBack={() => setIndex(Math.max(0, i - 1))}
      onDismiss={() => close('dismissed')}
      onFinish={() => close('done')}
    />
  )
}

function TourCard({
  steps,
  index,
  authed,
  onNext,
  onBack,
  onDismiss,
  onFinish,
}: {
  steps: TourStep[]
  index: number
  authed: boolean
  onNext: () => void
  onBack: () => void
  onDismiss: () => void
  onFinish: () => void
}) {
  const { messages } = useLocale()
  const t = messages.tour
  const step = steps[index]
  const isFirst = index === 0
  const isLast = index === steps.length - 1

  const cardRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<TourAnchor | null>(null)
  const [target, setTarget] = useState<Rect | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Mede o alvo e posiciona o cartão. Roda a cada passo e a cada resize/scroll (o header é sticky,
  // mas o teclado virtual e a rotação mudam a viewport).
  const measure = useCallback(() => {
    const a = resolveAnchor(step, (x) => findAnchor(x) !== null)
    const el = a ? findAnchor(a) : null
    const r = el?.getBoundingClientRect()
    const rect = r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null
    const card = cardRef.current?.getBoundingClientRect()
    setAnchor(a)
    setTarget(rect)
    setPos(
      placeTourCard(
        rect
          ? {
              top: rect.top - SPOTLIGHT_PAD,
              left: rect.left - SPOTLIGHT_PAD,
              width: rect.width + SPOTLIGHT_PAD * 2,
              height: rect.height + SPOTLIGHT_PAD * 2,
            }
          : null,
        { width: card?.width ?? 0, height: card?.height ?? 0 },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
  }, [step])

  // A 1ª medida vai num frame: o cartão já está no DOM (invisível) com o texto do passo, então o
  // tamanho dele é o real na hora de posicionar.
  useEffect(() => {
    const a = resolveAnchor(step, (x) => findAnchor(x) !== null)
    if (a) findAnchor(a)?.scrollIntoView({ block: 'nearest' })
    const frame = window.requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [measure, step])

  // O botão principal leva o foco a cada passo: Enter avança, Esc sai.
  useEffect(() => {
    primaryRef.current?.focus()
  }, [index])

  const { title, body } = stepCopy(step, t, authed)
  const viaMenu = anchor === 'menu-mobile'

  return (
    <Dialog.Root
      open
      onOpenChange={(o) => {
        if (!o) onDismiss()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="tour-overlay"
          className={target ? 'fixed inset-0 z-[90]' : 'fixed inset-0 z-[90] bg-black/60'}
        >
          {target && (
            <div
              aria-hidden="true"
              data-testid="tour-spotlight"
              // `outline` e não `ring`: o ring do Tailwind também é box-shadow e o recorte abaixo o apagaria.
              className="pointer-events-none fixed rounded-xl outline-2 outline-brand motion-safe:transition-all motion-safe:duration-200"
              style={{
                top: target.top - SPOTLIGHT_PAD,
                left: target.left - SPOTLIGHT_PAD,
                width: target.width + SPOTLIGHT_PAD * 2,
                height: target.height + SPOTLIGHT_PAD * 2,
                boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.6)',
              }}
            />
          )}
        </Dialog.Overlay>
        <Dialog.Content
          ref={cardRef}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            primaryRef.current?.focus()
          }}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className="fixed z-[91] w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-5 text-fg shadow-xl outline-none motion-safe:transition-[top,left] motion-safe:duration-200"
          style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {t.passoDe.replace('{atual}', String(index + 1)).replace('{total}', String(steps.length))}
            </p>
            <Dialog.Close
              aria-label={t.fechar}
              className="-m-1 inline-flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-brand/10 hover:text-fg"
            >
              <XIcon aria-hidden="true" className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Title className="mt-1 font-display text-xl font-semibold text-brand-ink">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-relaxed text-fg">
            {body}
            {viaMenu && <span className="mt-1 block text-muted">{t.noMenu}</span>}
          </Dialog.Description>

          {isFirst ? (
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onDismiss}>
                {t.agoraNao}
              </Button>
              <Button ref={primaryRef} size="sm" onClick={onNext}>
                {t.comecar}
              </Button>
            </div>
          ) : (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
              {isLast ? (
                <Button asChild variant="link" size="sm" className="px-0">
                  <Link href="/guia" onClick={onFinish}>
                    {t.verGuia}
                  </Link>
                </Button>
              ) : (
                <Button variant="link" size="sm" className="px-0 text-muted" onClick={onDismiss}>
                  {t.pular}
                </Button>
              )}
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={onBack}>
                  {t.voltar}
                </Button>
                <Button ref={primaryRef} size="sm" onClick={isLast ? onFinish : onNext}>
                  {isLast ? t.concluir : t.proximo}
                </Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
