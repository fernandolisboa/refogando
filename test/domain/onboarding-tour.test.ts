import { describe, it, expect } from 'vitest'
import {
  TOUR_NEW_ACCOUNT_WINDOW_MS,
  TOUR_MARGIN,
  TOUR_GAP,
  parseTourState,
  placeTourCard,
  resolveAnchor,
  shouldAutoStartTour,
  tourStepsFor,
  tourStorageKey,
} from '@/domain/onboarding-tour'

/** Tour guiado (ADR-0039) — o kernel puro: passos, âncoras, abertura automática e posição do cartão. */
describe('tourStepsFor', () => {
  it('logado: começa nas boas-vindas, termina no fim e inclui Salvos e Cardápio', () => {
    const ids = tourStepsFor(true).map((s) => s.id)
    expect(ids[0]).toBe('boasVindas')
    expect(ids.at(-1)).toBe('fim')
    expect(ids).toEqual(['boasVindas', 'busca', 'criar', 'salvos', 'cardapio', 'despensa', 'conta', 'fim'])
  })

  it('Visitante: sem os passos de links só-logados', () => {
    const ids = tourStepsFor(false).map((s) => s.id)
    expect(ids).toEqual(['boasVindas', 'busca', 'criar', 'conta', 'fim'])
  })
})

describe('resolveAnchor', () => {
  const salvos = tourStepsFor(true).find((s) => s.id === 'salvos')!

  it('prefere a âncora do desktop quando visível', () => {
    expect(resolveAnchor(salvos, () => true)).toBe('nav-salvos')
  })

  it('no celular (nav escondida) cai no botão do menu', () => {
    expect(resolveAnchor(salvos, (a) => a === 'menu-mobile')).toBe('menu-mobile')
  })

  it('nada visível ⇒ null (cartão centrado, o passo não some)', () => {
    expect(resolveAnchor(salvos, () => false)).toBeNull()
  })

  it('passo sem âncora (boas-vindas) ⇒ null', () => {
    expect(resolveAnchor(tourStepsFor(true)[0], () => true)).toBeNull()
  })
})

describe('estado gravado', () => {
  it('chave por usuário, versionada', () => {
    expect(tourStorageKey('u1')).toBe('refogando:tour:v1:u1')
  })

  it('parseTourState aceita só done/dismissed', () => {
    expect(parseTourState('done')).toBe('done')
    expect(parseTourState('dismissed')).toBe('dismissed')
    expect(parseTourState(null)).toBeNull()
    expect(parseTourState('lixo')).toBeNull()
  })
})

describe('shouldAutoStartTour', () => {
  const now = Date.parse('2026-09-28T12:00:00Z')
  const base = {
    authed: true,
    onHome: true,
    createdAt: new Date(now - 60_000),
    now,
    stored: null,
  } as const

  it('conta nova, na home, sem registro ⇒ abre', () => {
    expect(shouldAutoStartTour(base)).toBe(true)
  })

  it('aceita createdAt serializado (string ISO, como vem do JSON da sessão)', () => {
    expect(shouldAutoStartTour({ ...base, createdAt: new Date(now - 1000).toISOString() })).toBe(true)
  })

  it('Visitante nunca', () => {
    expect(shouldAutoStartTour({ ...base, authed: false })).toBe(false)
  })

  it('fora da home nunca', () => {
    expect(shouldAutoStartTour({ ...base, onHome: false })).toBe(false)
  })

  it('já terminou ou dispensou ⇒ não abre', () => {
    expect(shouldAutoStartTour({ ...base, stored: 'done' })).toBe(false)
    expect(shouldAutoStartTour({ ...base, stored: 'dismissed' })).toBe(false)
  })

  it('storage ilegível (undefined) ⇒ não abre (sem memória ele voltaria a cada visita)', () => {
    expect(shouldAutoStartTour({ ...base, stored: undefined })).toBe(false)
  })

  it('conta antiga (fora da janela de 14 dias) ⇒ não abre', () => {
    expect(shouldAutoStartTour({ ...base, createdAt: new Date(now - TOUR_NEW_ACCOUNT_WINDOW_MS - 1) })).toBe(false)
    expect(shouldAutoStartTour({ ...base, createdAt: new Date(now - TOUR_NEW_ACCOUNT_WINDOW_MS) })).toBe(true)
  })

  it('createdAt ausente, inválido ou no futuro ⇒ não abre', () => {
    expect(shouldAutoStartTour({ ...base, createdAt: null })).toBe(false)
    expect(shouldAutoStartTour({ ...base, createdAt: undefined })).toBe(false)
    expect(shouldAutoStartTour({ ...base, createdAt: 'não é data' })).toBe(false)
    expect(shouldAutoStartTour({ ...base, createdAt: new Date(now + 60_000) })).toBe(false)
  })
})

describe('placeTourCard', () => {
  const viewport = { width: 1280, height: 800 }
  const card = { width: 352, height: 200 }

  it('sem alvo ⇒ centrado', () => {
    expect(placeTourCard(null, card, viewport)).toEqual({ top: 300, left: 464 })
  })

  it('alvo no header ⇒ cartão abaixo, centrado no alvo', () => {
    const target = { top: 10, left: 600, width: 80, height: 40 }
    expect(placeTourCard(target, card, viewport)).toEqual({ top: 10 + 40 + TOUR_GAP, left: 640 - 176 })
  })

  it('alvo no pé da tela ⇒ cartão acima', () => {
    const target = { top: 700, left: 600, width: 80, height: 40 }
    expect(placeTourCard(target, card, viewport).top).toBe(700 - TOUR_GAP - 200)
  })

  it('alvo no canto ⇒ o cartão fica dentro da tela com margem', () => {
    const right = placeTourCard({ top: 10, left: 1250, width: 20, height: 20 }, card, viewport)
    expect(right.left).toBe(viewport.width - card.width - TOUR_MARGIN)
    const left = placeTourCard({ top: 10, left: 0, width: 20, height: 20 }, card, viewport)
    expect(left.left).toBe(TOUR_MARGIN)
  })

  it('tela estreita (celular) ⇒ nunca à esquerda da margem', () => {
    const phone = { width: 360, height: 640 }
    const p = placeTourCard({ top: 8, left: 310, width: 36, height: 36 }, { width: 328, height: 220 }, phone)
    expect(p.left).toBe(TOUR_MARGIN)
    expect(p.top).toBe(8 + 36 + TOUR_GAP)
  })

  it('não cabe nem abaixo nem acima ⇒ colado na base', () => {
    const tall = { width: 352, height: 700 }
    const p = placeTourCard({ top: 300, left: 600, width: 80, height: 40 }, tall, viewport)
    expect(p.top).toBe(viewport.height - 700 - TOUR_MARGIN)
  })
})
