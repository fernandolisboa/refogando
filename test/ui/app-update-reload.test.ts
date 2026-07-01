import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isChunkLoadError, reloadForAppUpdate } from '@/lib/app-update-reload'
import { stubReload } from './reload-stub'

/**
 * Módulo puro da atualização graceful (#372, ADR-0028 dec 5-A). Cobre a detecção de chunk error
 * e o reload one-shot com janela de tempo (loop-safe). jsdom não implementa `location.reload`
 * mockável via spyOn; `stubReload` troca o objeto location por um clone com reload espião.
 */
describe('app-update-reload — módulo puro', () => {
  let reloadSpy: ReturnType<typeof stubReload>['reload']
  let restoreReload: () => void

  beforeEach(() => {
    window.sessionStorage.clear()
    const s = stubReload()
    reloadSpy = s.reload
    restoreReload = s.restore
  })
  afterEach(() => {
    restoreReload()
    vi.restoreAllMocks()
  })

  describe('isChunkLoadError', () => {
    it('true por name ChunkLoadError', () => {
      expect(isChunkLoadError({ name: 'ChunkLoadError' })).toBe(true)
    })
    it('true por mensagem "Loading chunk N failed"', () => {
      expect(isChunkLoadError(new Error('Loading chunk 42 failed'))).toBe(true)
    })
    it('true por mensagem contendo "ChunkLoadError"', () => {
      expect(isChunkLoadError(null, 'algo ChunkLoadError aconteceu')).toBe(true)
    })
    it('false pra erro comum, objeto vazio e undefined', () => {
      expect(isChunkLoadError(new Error('boom'))).toBe(false)
      expect(isChunkLoadError({})).toBe(false)
      expect(isChunkLoadError(undefined)).toBe(false)
    })
  })

  describe('reloadForAppUpdate', () => {
    it('1ª chamada: recarrega uma vez e grava o timestamp', () => {
      reloadForAppUpdate()
      expect(reloadSpy).toHaveBeenCalledTimes(1)
      const stored = window.sessionStorage.getItem('app-update-reload')
      expect(stored).toBeTruthy()
      expect(Number(stored)).toBeGreaterThan(0)
    })

    it('2ª chamada dentro da janela: NÃO recarrega de novo (loop-safe)', () => {
      reloadForAppUpdate()
      reloadForAppUpdate()
      expect(reloadSpy).toHaveBeenCalledTimes(1)
    })

    it('após a janela expirar: recarrega de novo', () => {
      // Simula um reload antigo (> 10s atrás) gravado na sessão.
      window.sessionStorage.setItem('app-update-reload', String(Date.now() - 11_000))
      reloadForAppUpdate()
      expect(reloadSpy).toHaveBeenCalledTimes(1)
    })

    it('storage desabilitado: não lança e não recarrega', () => {
      // jsdom expõe sessionStorage como Proxy (spyOn não gruda); trocamos o objeto inteiro por um
      // fake cujo getItem lança (modela Safari privado).
      const original = window.sessionStorage
      Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        value: {
          getItem: () => {
            throw new Error('storage off')
          },
          setItem: () => {},
        },
      })
      try {
        expect(() => reloadForAppUpdate()).not.toThrow()
        expect(reloadSpy).not.toHaveBeenCalled()
      } finally {
        Object.defineProperty(window, 'sessionStorage', { configurable: true, value: original })
      }
    })
  })
})
