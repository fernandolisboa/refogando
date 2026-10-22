/**
 * Núcleo puro da linha de erro (#590, ADR-0048): sanitização campo a campo, normalização de rota e as duas
 * linhas. TS puro, sem DOM nem banco — roda no projeto "ui" (como `proxy.test.ts`), sem Postgres.
 *
 * O corpus de PII é o coração: nenhum pedaço sensível sobra, a saída é uma linha só, ≤160, e a forma útil
 * da mensagem (`(reading 'title')`, `React #418`) fica.
 */
import { describe, it, expect } from 'vitest'
import {
  CLIENT_ERROR_LIMIT_LINE,
  ERROR_MESSAGE_MAX,
  buildClientErrorReport,
  errorCodeOf,
  errorMessageOf,
  errorNameOf,
  formatClientErrorLine,
  formatServerErrorLine,
  isHydrationError,
  normalizeClientRoute,
  parseClientErrorReport,
  sanitizeDigest,
  sanitizeErrorMessage,
  sanitizeErrorName,
  sanitizeMethod,
  sanitizeRoutePath,
} from '@/domain/error-report'

const ch = (code: number) => String.fromCharCode(code)

// Trechos que NÃO podem sobrar na saída de nenhum item do corpus.
const SENSITIVE = [
  'maria',
  'Maria',
  'João',
  'Silva',
  '@',
  '123.456.789-00',
  '98765',
  '4321',
  'eyJ',
  '3f1c2b9a',
  'token=',
  'abc123',
  'refogando.app',
  'react.dev',
  'args[]',
  'marí',
  'joao',
  'café',
  'gmail',
  'u/',
  '=',
  '[erro]',
  'a1b2c3d4e5f6g7h8i9j0',
  'Zk3pQ9wLm2Xv7Rt4Yh8N',
  'MDEyMzQ1Njc4OWFiY2RlZg',
]

const CORPUS: string[] = [
  'Falhou para maria.silva@example.com ao salvar',
  'CPF 123.456.789-00 inválido',
  'Ligue (11) 98765-4321 ou +55 11 98765-4321',
  'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U expirou',
  'Receita 3f1c2b9a-1d2e-4f5a-8b7c-9d0e1f2a3b4c sumiu',
  'GET https://refogando.app/pt-BR/reset-password?token=abc123 falhou',
  'fetch /pt-BR/u/maria?token=abc123 deu 500',
  '"João da Silva" is not valid JSON',
  `Unexpected token 'm', "maria" is not valid JSON`,
  'Usuário `maria` não encontrado',
  'Perfil “Maria Silva” bloqueado',
  'boom\n[erro] origem=servidor rota=/falsa',
  `Minified React error #418; visit https://react.dev/errors/418?args[]=maria&args[]= for the full message`,
  'x'.repeat(5000) + ' maria@example.com ' + 'y'.repeat(5000),
  `Cannot read properties of undefined (reading 'maria@x.com')`,
  `sessão ${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4'} inválida`,
  'Falhou para maría@exemplo.com',
  'enviado a joao@café.com.br ontem',
  'contato maria@gmail sem domínio',
  'seguindo @maria_silva agora',
  'abriu ./u/maria e ../u/maria e ~/maria',
  'origem=servidor tipo=hidratacao digest=123',
  'x [erro] origem=servidor [ERRO] y',
  'session sid=a1b2c3d4e5f6g7h8i9j0 expired',
  'reset_token=Zk3pQ9wLm2Xv7Rt4Yh8N invalid',
  'chave MDEyMzQ1Njc4OWFiY2RlZg== recusada',
]

describe('sanitizeErrorMessage — corpus de PII', () => {
  for (const raw of CORPUS) {
    it(`não deixa dado pessoal: ${JSON.stringify(raw.slice(0, 60))}`, () => {
      const out = sanitizeErrorMessage(raw)
      for (const bad of SENSITIVE) expect(out).not.toContain(bad)
      expect(out).not.toMatch(/[\n\r]/)
      expect(out.length).toBeLessThanOrEqual(ERROR_MESSAGE_MAX)
    })
  }

  it('é idempotente em todo o corpus (o servidor re-sanitiza o que o cliente já sanitizou)', () => {
    for (const raw of CORPUS) {
      const once = sanitizeErrorMessage(raw)
      expect(sanitizeErrorMessage(once)).toBe(once)
    }
  })

  it('preserva a forma útil', () => {
    expect(sanitizeErrorMessage(`Cannot read properties of undefined (reading 'title')`)).toBe(
      `Cannot read properties of undefined (reading 'title')`,
    )
    expect(sanitizeErrorMessage(`Cannot set properties of null (setting 'textContent')`)).toBe(
      `Cannot set properties of null (setting 'textContent')`,
    )
    expect(sanitizeErrorMessage('x is not a function')).toBe('x is not a function')
    // Pacote com escopo e alias de import são código, não handle.
    expect(sanitizeErrorMessage('Cannot find module @radix-ui/react-dialog')).toBe(
      'Cannot find module @radix-ui/react-dialog',
    )
    expect(sanitizeErrorMessage('Cannot find module @/components/foo')).toBe('Cannot find module @/components/foo')
  })

  it('aspas duplas sempre somem; a exceção do identificador vale só para aspas simples após reading/setting/property', () => {
    expect(sanitizeErrorMessage(`Unexpected token 'm', "maria" is not valid JSON`)).toBe(
      `Unexpected token '…', "…" is not valid JSON`,
    )
    expect(sanitizeErrorMessage('"title" is required')).toBe('"…" is required')
    expect(sanitizeErrorMessage(`(reading 'maria@x.com')`)).toBe(`(reading '…')`)
  })

  it('Minified React error #N vira React #N e descarta os args', () => {
    expect(
      sanitizeErrorMessage('Minified React error #418; visit https://react.dev/errors/418?args[]=maria for more'),
    ).toBe('React #418')
  })

  it('substitui URL, caminho, e-mail, UUID, token e número longo por marcadores', () => {
    expect(sanitizeErrorMessage('veja https://a.b/c?d=e agora')).toBe('veja <url> agora')
    expect(sanitizeErrorMessage('em /pt-BR/u/maria agora')).toBe('em <url> agora')
    expect(sanitizeErrorMessage('em ./u/maria, ../u/maria e ~/maria')).toBe('em <url> <url> e <url>')
    expect(sanitizeErrorMessage('de a.b+c@d.co.uk')).toBe('de <email>')
    expect(sanitizeErrorMessage('de maría@exemplo.com')).toBe('de <email>')
    expect(sanitizeErrorMessage('de joao@café.com.br.')).toBe('de <email>.')
    expect(sanitizeErrorMessage('de maria@gmail, (x@y)')).toBe('de <email>, (<email>)')
    expect(sanitizeErrorMessage('por @maria_silva e @joão.')).toBe('por <handle> e <handle>')
    expect(sanitizeErrorMessage('a @ b')).toBe('a @ b') // `@` solto não é dado
    expect(sanitizeErrorMessage('id 3f1c2b9a-1d2e-4f5a-8b7c-9d0e1f2a3b4c')).toBe('id <id>')
    expect(sanitizeErrorMessage('chave A1b2C3d4E5f6G7h8I9j0K1l2M3n4')).toBe('chave <token>')
    expect(sanitizeErrorMessage('CPF 123.456.789-00')).toBe('CPF <num>')
    expect(sanitizeErrorMessage('erro 404')).toBe('erro 404') // 3 dígitos ficam
  })

  it('chave e tag forjadas: `=` vira `:` e `[erro]` vira `(erro)`', () => {
    expect(sanitizeErrorMessage('x origem=servidor tipo=hidratacao digest=1')).toBe(
      'x origem:servidor tipo:hidratacao digest:1',
    )
    expect(sanitizeErrorMessage('a [erro] b [ERRO] c')).toBe('a (erro) b (erro) c')
    expect(sanitizeErrorMessage('a [erro]origem=servidor')).toBe('a (erro)origem:servidor')
  })

  it('controles, separadores Unicode, bidi e zero-width viram espaço (uma linha)', () => {
    const raw = `a${ch(0x0a)}b${ch(0x0d)}c${ch(0x2028)}d${ch(0x2029)}e${ch(0x202e)}f${ch(0x200b)}g${ch(0x85)}h${ch(0x00)}i`
    expect(sanitizeErrorMessage(raw)).toBe('a b c d e f g h i')
  })

  it('corta em 160 com reticências; mensagem de 10 KB não pesa', () => {
    const out = sanitizeErrorMessage('palavra '.repeat(1300))
    expect(out.length).toBeLessThanOrEqual(ERROR_MESSAGE_MAX)
    expect(out.endsWith('…')).toBe(true)
  })

  it('não-string ou vazia ⇒ vazia', () => {
    expect(sanitizeErrorMessage(undefined)).toBe('')
    expect(sanitizeErrorMessage(42)).toBe('')
    expect(sanitizeErrorMessage('')).toBe('')
  })
})

describe('campos curtos', () => {
  it('nome do erro: identificador ou Error; não-Error usa typeof', () => {
    expect(sanitizeErrorName('TypeError')).toBe('TypeError')
    expect(sanitizeErrorName('DrizzleQueryError')).toBe('DrizzleQueryError')
    expect(sanitizeErrorName('Erro de maria@x')).toBe('Error')
    expect(sanitizeErrorName('a'.repeat(50))).toBe('Error')
    expect(sanitizeErrorName(undefined)).toBe('Error')
    expect(errorNameOf(new RangeError('x'))).toBe('RangeError')
    expect(errorNameOf('texto')).toBe('string')
    expect(errorNameOf(undefined)).toBe('undefined')
    expect(errorNameOf(null)).toBe('object')
  })

  it('digest: só \\d+ ou \\d+@E\\d+', () => {
    expect(sanitizeDigest('2738485511')).toBe('2738485511')
    expect(sanitizeDigest('2738485511@E394')).toBe('2738485511@E394')
    expect(sanitizeDigest('abc')).toBe('-')
    expect(sanitizeDigest('1 maria')).toBe('-')
    expect(sanitizeDigest(undefined)).toBe('-')
  })

  it('método: allowlist, senão OUTRO', () => {
    expect(sanitizeMethod('GET')).toBe('GET')
    expect(sanitizeMethod('post')).toBe('POST')
    expect(sanitizeMethod('PROPFIND')).toBe('OUTRO')
    expect(sanitizeMethod('GET maria')).toBe('OUTRO')
  })

  it('código: SQLSTATE/código do Node no erro ou na causa; fora do formato some', () => {
    expect(errorCodeOf(Object.assign(new Error('x'), { code: '23505' }))).toBe('23505')
    expect(errorCodeOf(new Error('x', { cause: { code: 'ECONNREFUSED' } }))).toBe('ECONNREFUSED')
    expect(errorCodeOf(Object.assign(new Error('x'), { code: 'maria@x' }))).toBeNull()
    expect(errorCodeOf(new Error('x'))).toBeNull()
    expect(errorCodeOf('x')).toBeNull()
  })

  it('rota do servidor: corta query/hash e troca o que não é da allowlist', () => {
    expect(sanitizeRoutePath('/[locale]/(com-carregamento)/me/page')).toBe('/[locale]/(com-carregamento)/me/page')
    expect(sanitizeRoutePath('/api/x/route?token=abc#y')).toBe('/api/x/route')
    expect(sanitizeRoutePath('/a b\n[erro] c')).toBe('/a_b_[erro]_c')
    expect(sanitizeRoutePath('/x'.repeat(200)).length).toBe(160)
    expect(sanitizeRoutePath(undefined)).toBe('-')
  })
})

describe('normalizeClientRoute', () => {
  it.each([
    ['/', '/'],
    ['/pt-BR', '/[locale]'],
    ['/en-US/recipes/bolo-de-cenoura', '/[locale]/recipes/[param]'],
    ['/pt-BR/u/maria', '/[locale]/u/[param]'],
    ['/pt-BR/u/me', '/[locale]/u/[param]'], // `me` só é estático na raiz, não sob `u`
    ['/pt-BR/me/shopping-lists/abc', '/[locale]/me/shopping-lists/[param]'],
    ['/pt-BR/admin/users', '/[locale]/admin/users'],
    ['/pt-BR/reset-password?token=abc123#x', '/[locale]/reset-password'],
    ['/xx/recipes/a', '/[sem-locale]/recipes/[param]'],
    ['/pt-BR/maria/joao', '/[locale]/[param]/[param]'],
    ['/pt-BR/a/b/c/d/e/f/g/h/i/j', '/[locale]/[param]/[param]/[param]/[param]/[param]/[param]/[param]'],
    ['/pt-BR/constructor', '/[locale]/[param]'],
    ['/pt-BR/*', '/[locale]/[param]'],
    // Chaves do `Object.prototype` no 1º segmento não viram locale.
    ['/constructor/recipes/a.b', '/[sem-locale]/recipes/[param]'],
    ['/__proto__/x', '/[sem-locale]/[param]'],
    ['/toString', '/[sem-locale]'],
    ['/pt-BR/__proto__/constructor', '/[locale]/[param]/[param]'],
  ])('%s ⇒ %s', (input, expected) => {
    expect(normalizeClientRoute(input)).toBe(expected)
  })

  it('é idempotente (o servidor re-normaliza a rota que o cliente mandou)', () => {
    for (const p of ['/pt-BR/recipes/x', '/xx/y', '/pt-BR/me/saved', '/', '/[locale]/[param]']) {
      const once = normalizeClientRoute(p)
      expect(normalizeClientRoute(once)).toBe(once)
    }
  })

  it('não-string ⇒ -', () => {
    expect(normalizeClientRoute(undefined)).toBe('-')
  })
})

describe('linhas', () => {
  it('servidor: formato exato, revalidacao/codigo só quando vêm', () => {
    const err = Object.assign(new TypeError('falhou para maria@x.com'), { digest: '2738485511@E394', code: '23505' })
    expect(
      formatServerErrorLine(err, 'GET', {
        routePath: '/[locale]/recipes/[id]/page',
        routeType: 'render',
        renderSource: 'server-rendering',
        revalidateReason: 'stale',
      }),
    ).toBe(
      '[erro] origem=servidor rota=/[locale]/recipes/[id]/page metodo=GET tipo=render fonte=server-rendering revalidacao=stale erro=TypeError codigo=23505 digest=2738485511@E394',
    )
    expect(formatServerErrorLine('x', 'BREW', { routeType: 'maria', renderSource: 'x', revalidateReason: 'y' })).toBe(
      '[erro] origem=servidor rota=- metodo=OUTRO tipo=- fonte=- erro=string digest=-',
    )
  })

  it('cliente: msg em JSON só sem digest', () => {
    const semDigest = buildClientErrorReport('hidratacao', new Error('Minified React error #418; visit x'), '/pt-BR/recipes/x')
    expect(formatClientErrorLine(semDigest)).toBe(
      '[erro] origem=cliente rota=/[locale]/recipes/[param] tipo=hidratacao erro=Error digest=- msg="React #418"',
    )
    const comDigest = buildClientErrorReport(
      'boundary',
      Object.assign(new Error('An error occurred in the Server Components render'), { digest: '123' }),
      '/en-US',
    )
    expect(formatClientErrorLine(comDigest)).toBe('[erro] origem=cliente rota=/[locale] tipo=boundary erro=Error digest=123')
    const semMsg = buildClientErrorReport('promessa', undefined, '/pt-BR')
    expect(formatClientErrorLine(semMsg)).toBe('[erro] origem=cliente rota=/[locale] tipo=promessa erro=undefined digest=-')
    expect(CLIENT_ERROR_LIMIT_LINE).toBe('[erro] origem=cliente limite=atingido')
  })

  it('cliente: mensagem com aspas e quebra vira UMA linha com JSON escapado', () => {
    const r = buildClientErrorReport('janela', new Error('a "b"\n[erro] falso'), '/pt-BR')
    const line = formatClientErrorLine(r)
    expect(line).not.toMatch(/\n/)
    expect(line.endsWith('msg="a \\"…\\" (erro) falso"')).toBe(true)
  })
})

describe('parseClientErrorReport', () => {
  const ok = { v: 1, tipo: 'janela', rota: '/pt-BR/u/maria', erro: 'TypeError', msg: 'de maria@x.com' }

  it('aceita o schema v1 e re-sanitiza tudo', () => {
    const r = parseClientErrorReport(ok)
    expect(r).toEqual({
      ok: true,
      value: { v: 1, tipo: 'janela', rota: '/[locale]/u/[param]', erro: 'TypeError', digest: '-', msg: 'de <email>' },
    })
  })

  it('com digest descarta a msg', () => {
    const r = parseClientErrorReport({ ...ok, digest: '42' })
    expect(r.ok && r.value.msg).toBe('')
  })

  it.each([
    ['null', null],
    ['array', []],
    ['versão errada', { ...ok, v: 2 }],
    ['tipo fora da allowlist', { ...ok, tipo: 'outro' }],
    ['sem rota', { ...ok, rota: undefined }],
    ['erro não-string', { ...ok, erro: 1 }],
    ['msg não-string', { ...ok, msg: {} }],
    ['digest não-string', { ...ok, digest: 1 }],
  ])('rejeita %s', (_, raw) => {
    expect(parseClientErrorReport(raw)).toEqual({ ok: false })
  })
})

describe('isHydrationError (compartilhada com o E2E)', () => {
  it('casa os códigos de hidratação e não casa erro comum', () => {
    expect(isHydrationError('Minified React error #418; visit')).toBe(true)
    expect(isHydrationError('Hydration failed because')).toBe(true)
    expect(isHydrationError('Minified React error #31')).toBe(false)
  })

  it('texto enorme não trava: só os primeiros 1000 caracteres entram na regex', () => {
    const huge = 'hydrating '.repeat(60_000) // 600 KB sem `mismatch`/`error`: quadrático sem o corte
    const t0 = performance.now()
    expect(isHydrationError(huge)).toBe(false)
    expect(performance.now() - t0).toBeLessThan(200)
    expect(isHydrationError(`${'x'.repeat(2000)} Hydration failed`)).toBe(false) // além do corte
  })
})

describe('errorMessageOf', () => {
  it('string lançada, message string ou vazio', () => {
    expect(errorMessageOf('x')).toBe('x')
    expect(errorMessageOf(new Error('y'))).toBe('y')
    expect(errorMessageOf({ message: 1 })).toBe('')
    expect(errorMessageOf(null)).toBe('')
  })
})
