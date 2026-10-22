/**
 * Relato de erro do navegador (#590, ADR-0048): `reportClientError` e os listeners de janela. Transporte e
 * storage injetados; o transporte default é provado com `fetch` stubado (keepalive, sem cookie, sem
 * referrer). Invariantes: nunca lança, nunca escreve no console, desligado fora de produção.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  CLIENT_ERRORS_ENDPOINT,
  installClientErrorListeners,
  reportClientError,
  resetClientErrorReportState,
} from '@/lib/client-error-report'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v
    },
  }
}

const throwingStorage = {
  getItem: () => {
    throw new Error('bloqueado')
  },
  setItem: () => {
    throw new Error('bloqueado')
  },
}

let consoleSpies: ReturnType<typeof vi.spyOn>[] = []

beforeEach(() => {
  resetClientErrorReportState()
  window.sessionStorage.clear()
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  )
})

afterEach(() => {
  // Contrato: o relato nunca escreve no console do navegador (o guarda do E2E reprova).
  for (const s of consoleSpies) expect(s).not.toHaveBeenCalled()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('reportClientError', () => {
  it('desligado fora de produção (default) ⇒ não manda', () => {
    const send = vi.fn()
    expect(reportClientError('boundary', new Error('x'), { send })).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('manda o relato v1 sanitizado, com a rota normalizada do pathname', () => {
    const send = vi.fn()
    window.history.replaceState(null, '', '/en-US/recipes/bolo-de-cenoura?token=abc')
    expect(
      reportClientError('boundary', new TypeError('falhou p/ maria@x.com'), { enabled: true, send, storage: null }),
    ).toBe(true)
    expect(JSON.parse(send.mock.calls[0][0])).toEqual({
      v: 1,
      tipo: 'boundary',
      rota: '/[locale]/recipes/[param]',
      erro: 'TypeError',
      digest: '-',
      msg: 'falhou p/ <email>',
    })
  })

  it('com digest manda sem mensagem', () => {
    const send = vi.fn()
    const err = Object.assign(new Error('An error occurred in the Server Components render.'), { digest: '99' })
    reportClientError('boundary', err, { enabled: true, send, storage: null, pathname: '/pt-BR' })
    expect(JSON.parse(send.mock.calls[0][0])).toMatchObject({ digest: '99', msg: '' })
  })

  it('erro de chunk velho não é relatado (é atualização, não bug)', () => {
    const send = vi.fn()
    const opts = { enabled: true, send, storage: null, pathname: '/pt-BR' }
    expect(reportClientError('boundary', Object.assign(new Error('x'), { name: 'ChunkLoadError' }), opts)).toBe(false)
    expect(reportClientError('boundary', new Error('Loading chunk 9 failed.'), opts)).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('deduplica o mesmo erro na mesma rota', () => {
    const send = vi.fn()
    const opts = { enabled: true, send, storage: null, pathname: '/pt-BR' }
    reportClientError('janela', new Error('igual'), opts)
    reportClientError('janela', new Error('igual'), opts)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('teto de 5 por carga', () => {
    const send = vi.fn()
    const opts = { enabled: true, send, storage: null, pathname: '/pt-BR' }
    for (let i = 0; i < 8; i++) reportClientError('janela', new Error(`erro ${'abcdefgh'[i]}`), opts)
    expect(send).toHaveBeenCalledTimes(5)
  })

  it('teto de 20 por sessão (sessionStorage guarda só o contador)', () => {
    const send = vi.fn()
    const storage = memoryStorage({ 'erro-relatos': '19' })
    const opts = { enabled: true, send, storage, pathname: '/pt-BR' }
    expect(reportClientError('janela', new Error('a'), opts)).toBe(true)
    expect(storage.data).toEqual({ 'erro-relatos': '20' })
    expect(reportClientError('janela', new Error('b'), opts)).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('usa window.sessionStorage por default', () => {
    reportClientError('janela', new Error('a'), { enabled: true, send: vi.fn(), pathname: '/pt-BR' })
    expect(window.sessionStorage.getItem('erro-relatos')).toBe('1')
  })

  it('storage que lança ⇒ segue só com a memória, sem lançar', () => {
    const send = vi.fn()
    expect(
      reportClientError('janela', new Error('a'), { enabled: true, send, storage: throwingStorage, pathname: '/pt-BR' }),
    ).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('transporte que lança não propaga', () => {
    const send = vi.fn(() => {
      throw new Error('sem rede')
    })
    expect(() => reportClientError('janela', new Error('a'), { enabled: true, send, storage: null, pathname: '/' })).not.toThrow()
  })

  it('transporte default: fetch POST keepalive, sem cookie e sem referrer; rejeição engolida', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)
    reportClientError('janela', new Error('a'), { enabled: true, storage: null, pathname: '/pt-BR' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(CLIENT_ERRORS_ENDPOINT)
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit', referrerPolicy: 'no-referrer' })
    expect(JSON.parse(init.body)).toMatchObject({ v: 1, tipo: 'janela' })
    await Promise.resolve() // a rejeição é tratada (sem unhandledrejection)
  })
})

describe('installClientErrorListeners', () => {
  function install() {
    const send = vi.fn()
    const uninstall = installClientErrorListeners(window, { enabled: true, send, storage: null, pathname: '/pt-BR/me' })
    const sent = () => send.mock.calls.map((c) => JSON.parse(c[0]))
    return { send, uninstall, sent }
  }

  function fireError(init: ErrorEventInit) {
    window.dispatchEvent(new ErrorEvent('error', init))
  }

  function fireRejection(reason: unknown) {
    // Duck typing no listener: um Event com `reason` basta (o jsdom não tem PromiseRejectionEvent).
    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }))
  }

  it('desligado ⇒ não instala', () => {
    const add = vi.spyOn(window, 'addEventListener')
    installClientErrorListeners(window)
    expect(add).not.toHaveBeenCalled()
  })

  it('erro não pego ⇒ janela; hidratação ⇒ hidratacao; rejeição ⇒ promessa', () => {
    const { uninstall, sent } = install()
    fireError({ error: new TypeError("x (reading 'title')"), message: "Uncaught TypeError: x (reading 'title')" })
    fireError({ error: new Error('Minified React error #418; visit https://react.dev/errors/418?args[]=a') })
    fireRejection(new RangeError('fora'))
    fireRejection('texto solto')
    uninstall()
    expect(sent()).toEqual([
      { v: 1, tipo: 'janela', rota: '/[locale]/me', erro: 'TypeError', digest: '-', msg: "x (reading 'title')" },
      { v: 1, tipo: 'hidratacao', rota: '/[locale]/me', erro: 'Error', digest: '-', msg: 'React #418' },
      { v: 1, tipo: 'promessa', rota: '/[locale]/me', erro: 'RangeError', digest: '-', msg: 'fora' },
      { v: 1, tipo: 'promessa', rota: '/[locale]/me', erro: 'string', digest: '-', msg: 'texto solto' },
    ])
  })

  it('ErrorEvent sem error usa a mensagem do evento', () => {
    const { uninstall, sent } = install()
    fireError({ message: 'algo quebrou', filename: `${window.location.origin}/_next/static/chunks/a.js` })
    uninstall()
    expect(sent()).toEqual([{ v: 1, tipo: 'janela', rota: '/[locale]/me', erro: 'Error', digest: '-', msg: 'algo quebrou' }])
  })

  it('filtra o ruído', () => {
    const { send, uninstall } = install()
    fireError({ message: 'Script error.' })
    fireError({ message: 'boom', filename: 'https://terceiro.example/x.js', error: new Error('boom') })
    fireError({ error: Object.assign(new Error('boom'), { stack: 'Error: boom\n at chrome-extension://abc/x.js:1:1' }) })
    fireError({ error: new Error('ResizeObserver loop completed with undelivered notifications.') })
    fireError({ error: Object.assign(new Error('x'), { name: 'ChunkLoadError' }) })
    // O Turbopack lança `Failed to load chunk …` com `name = 'ChunkLoadError'`.
    fireRejection(
      Object.assign(new Error('Failed to load chunk /_next/static/chunks/a.js'), { name: 'ChunkLoadError' }),
    )
    fireRejection(new DOMException('The operation was aborted.', 'AbortError'))
    fireRejection(new TypeError('Failed to fetch'))
    fireRejection(new TypeError('NetworkError when attempting to fetch resource.'))
    fireRejection(new TypeError('Load failed'))
    window.dispatchEvent(new Event('error')) // erro de recurso (não é ErrorEvent)
    uninstall()
    expect(send).not.toHaveBeenCalled()
  })

  it('a função devolvida remove os listeners', () => {
    const { send, uninstall } = install()
    uninstall()
    // Só `message` (sem `error`): sem nenhum listener nosso, o Vitest trataria um `error` como exceção não pega.
    fireError({ message: 'depois' })
    fireRejection(new Error('depois'))
    expect(send).not.toHaveBeenCalled()
  })
})
