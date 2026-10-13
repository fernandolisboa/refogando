import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

/**
 * `useOnTabReturn` (ADR-0028): `focus` + `visibilitychange`→visible coalescidos em UM disparo por volta
 * à aba. Date fixo (`toFake: ['Date']`) pra controlar a janela de coalescência.
 */

import { useOnTabReturn, TAB_RETURN_COALESCE_MS } from '@/components/use-tab-return'

const T0 = new Date(2026, 9, 13, 12, 0, 0).getTime()
const focus = () => window.dispatchEvent(new Event('focus'))
const visibility = (state: DocumentVisibilityState) => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('useOnTabReturn', () => {
  it('visibilitychange + focus (volta à aba) → 1 disparo, em qualquer ordem', () => {
    const cb = vi.fn()
    renderHook(() => useOnTabReturn(cb))
    visibility('visible')
    focus()
    expect(cb).toHaveBeenCalledTimes(1)

    vi.setSystemTime(T0 + TAB_RETURN_COALESCE_MS + 1)
    focus()
    visibility('visible')
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('só focus (refoco simples da janela) → 1 disparo', () => {
    const cb = vi.fn()
    renderHook(() => useOnTabReturn(cb))
    focus()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('dentro da janela coalesce; passada a janela dispara de novo', () => {
    const cb = vi.fn()
    renderHook(() => useOnTabReturn(cb))
    focus()
    vi.setSystemTime(T0 + TAB_RETURN_COALESCE_MS - 1)
    focus()
    expect(cb).toHaveBeenCalledTimes(1)
    vi.setSystemTime(T0 + TAB_RETURN_COALESCE_MS)
    focus()
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('visibilitychange ao ESCONDER não dispara', () => {
    const cb = vi.fn()
    renderHook(() => useOnTabReturn(cb))
    visibility('hidden')
    expect(cb).not.toHaveBeenCalled()
  })

  it('enabled=false não instala listeners; ao habilitar passa a disparar', () => {
    const cb = vi.fn()
    const { rerender } = renderHook(({ on }) => useOnTabReturn(cb, on), { initialProps: { on: false } })
    focus()
    visibility('visible')
    expect(cb).not.toHaveBeenCalled()
    rerender({ on: true })
    focus()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('enabled piscando (ex.: isPending num refetch) não zera a janela', () => {
    const cb = vi.fn()
    const { rerender } = renderHook(({ on }) => useOnTabReturn(cb, on), { initialProps: { on: true } })
    focus()
    rerender({ on: false })
    rerender({ on: true })
    visibility('visible')
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('usa o callback mais recente sem reinstalar listeners', () => {
    const first = vi.fn()
    const second = vi.fn()
    const add = vi.spyOn(window, 'addEventListener')
    const { rerender } = renderHook(({ cb }) => useOnTabReturn(cb), { initialProps: { cb: first } })
    const installs = add.mock.calls.filter(([type]) => type === 'focus').length
    rerender({ cb: second })
    expect(add.mock.calls.filter(([type]) => type === 'focus').length).toBe(installs)
    focus()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('desmontar remove os listeners', () => {
    const cb = vi.fn()
    const { unmount } = renderHook(() => useOnTabReturn(cb))
    unmount()
    focus()
    visibility('visible')
    expect(cb).not.toHaveBeenCalled()
  })
})
