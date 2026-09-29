/**
 * Tour guiado (ADR-0039) — o kernel PURO: quais passos existem, em que ordem, qual alvo cada um
 * destaca, quando o tour abre sozinho e onde o cartão do passo fica na tela. Sem DOM, sem React,
 * sem storage: a casca (`components/onboarding/guided-tour.tsx`) mede os elementos e lê o
 * localStorage, e pergunta tudo o mais aqui.
 */

/**
 * Âncoras do tour: o valor do atributo `data-tour` nos elementos da chrome. Um passo lista os seus
 * candidatos em ordem de preferência; vale o primeiro VISÍVEL (no celular a nav fica no drawer, então
 * o passo cai no botão do menu).
 */
export type TourAnchor =
  | 'busca'
  | 'criar'
  | 'nav-salvos'
  | 'nav-cardapio'
  | 'nav-despensa'
  | 'conta'
  | 'menu-mobile'

export type TourStepId =
  | 'boasVindas'
  | 'busca'
  | 'criar'
  | 'salvos'
  | 'cardapio'
  | 'despensa'
  | 'conta'
  | 'fim'

export type TourStep = {
  id: TourStepId
  /** Candidatos a destaque, em ordem. Vazio = cartão centrado, sem destaque (boas-vindas e fim). */
  anchors: readonly TourAnchor[]
  /** Só faz sentido logado (o link nem existe para o Visitante). */
  authOnly: boolean
}

export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'boasVindas', anchors: [], authOnly: false },
  { id: 'busca', anchors: ['busca'], authOnly: false },
  { id: 'criar', anchors: ['criar', 'menu-mobile'], authOnly: false },
  { id: 'salvos', anchors: ['nav-salvos', 'menu-mobile'], authOnly: true },
  { id: 'cardapio', anchors: ['nav-cardapio', 'menu-mobile'], authOnly: true },
  { id: 'despensa', anchors: ['nav-despensa', 'menu-mobile'], authOnly: true },
  { id: 'conta', anchors: ['conta', 'menu-mobile'], authOnly: false },
  { id: 'fim', anchors: [], authOnly: false },
]

/** Os passos que valem para quem está vendo: o Visitante não vê os passos de links só-logados. */
export function tourStepsFor(authed: boolean): TourStep[] {
  return TOUR_STEPS.filter((s) => authed || !s.authOnly)
}

/**
 * Escolhe a âncora do passo: a primeira candidata para a qual `isVisible` diz sim. `null` = nenhuma
 * visível (ou o passo não tem âncora) ⇒ o cartão fica centrado, sem destaque. Nunca pula o passo: o
 * texto continua útil mesmo sem o alvo à vista.
 */
export function resolveAnchor(
  step: TourStep,
  isVisible: (anchor: TourAnchor) => boolean,
): TourAnchor | null {
  for (const a of step.anchors) if (isVisible(a)) return a
  return null
}

/**
 * Estado gravado por usuário e dispositivo. `done` = viu até o fim; `dismissed` = fechou antes. Os dois
 * encerram a abertura automática; a diferença fica só pra leitura (e pra um futuro "quantos pulam").
 */
export type TourState = 'done' | 'dismissed'

/** Versão no nome da chave: um tour novo (passos muito diferentes) sobe a versão e reabre uma vez. */
export const TOUR_STORAGE_PREFIX = 'refogando:tour:v1:'

export function tourStorageKey(userId: string): string {
  return `${TOUR_STORAGE_PREFIX}${userId}`
}

export function parseTourState(raw: string | null): TourState | null {
  return raw === 'done' || raw === 'dismissed' ? raw : null
}

/** Janela de "conta nova": o tour abre sozinho só para quem se cadastrou há até 14 dias. */
export const TOUR_NEW_ACCOUNT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

/**
 * O tour abre sozinho? Só para quem está logado, na home, com conta nova (criada há até 14 dias) e que
 * ainda não terminou nem dispensou o tour neste dispositivo. `stored === undefined` significa que o
 * storage não pôde ser lido (modo privado, bloqueado): aí NÃO abre, porque sem memória ele voltaria a
 * cada visita, e isso é pior do que não abrir.
 */
export function shouldAutoStartTour(input: {
  authed: boolean
  onHome: boolean
  createdAt: Date | string | null | undefined
  now: number
  stored: TourState | null | undefined
}): boolean {
  const { authed, onHome, createdAt, now, stored } = input
  if (!authed || !onHome) return false
  if (stored !== null) return false
  if (createdAt == null) return false
  const created = new Date(createdAt).getTime()
  if (!Number.isFinite(created)) return false
  const age = now - created
  return age >= 0 && age <= TOUR_NEW_ACCOUNT_WINDOW_MS
}

export type Rect = { top: number; left: number; width: number; height: number }
export type Size = { width: number; height: number }

/** Folga entre o destaque e o cartão, e entre o cartão e a borda da tela. */
export const TOUR_GAP = 12
export const TOUR_MARGIN = 16

/**
 * Onde o cartão do passo fica: abaixo do alvo quando cabe, senão acima, senão colado na base da tela;
 * na horizontal, alinhado ao alvo e contido na tela com margem. Sem alvo, centrado. Coordenadas de
 * viewport (o cartão é `position: fixed`).
 */
export function placeTourCard(target: Rect | null, card: Size, viewport: Size): { top: number; left: number } {
  const maxLeft = Math.max(TOUR_MARGIN, viewport.width - card.width - TOUR_MARGIN)
  const maxTop = Math.max(TOUR_MARGIN, viewport.height - card.height - TOUR_MARGIN)
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

  if (!target) {
    return {
      top: clamp((viewport.height - card.height) / 2, TOUR_MARGIN, maxTop),
      left: clamp((viewport.width - card.width) / 2, TOUR_MARGIN, maxLeft),
    }
  }

  const below = target.top + target.height + TOUR_GAP
  const above = target.top - TOUR_GAP - card.height
  let top: number
  if (below + card.height <= viewport.height - TOUR_MARGIN) top = below
  else if (above >= TOUR_MARGIN) top = above
  else top = maxTop

  // Centro do cartão no centro do alvo, contido na tela.
  const left = clamp(target.left + target.width / 2 - card.width / 2, TOUR_MARGIN, maxLeft)
  return { top, left }
}
