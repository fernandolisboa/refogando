import { describe, expect, it } from 'vitest'
import {
  HANDLE_MAX_LEN,
  RESERVED_HANDLES,
  disambiguate,
  handleBaseFromName,
  slugify,
  validateHandle,
} from '@/domain/handle'

/**
 * Lógica PURA de handle (#128) — sem DB, sem Better Auth. Cobre slug, fallback de base,
 * desambiguação numérica, palavras reservadas e validação de formato. A unicidade real
 * (consulta ao banco) é testada na integração; aqui só a forma e as regras.
 */

describe('slugify (nome → slug-base)', () => {
  it('minúsculas + acentos dobrados pra ascii', () => {
    expect(slugify('Ana Júlia')).toBe('ana-julia')
    expect(slugify('JOÃO')).toBe('joao')
    expect(slugify('Çedilha Ção')).toBe('cedilha-cao')
  })

  it('só [a-z0-9-]: símbolos/espaços/_ viram hífen, colapsado e aparado', () => {
    expect(slugify('  Maria   Silva  ')).toBe('maria-silva')
    expect(slugify('foo_bar.baz')).toBe('foo-bar-baz')
    expect(slugify('a---b')).toBe('a-b')
    expect(slugify('!!!hello!!!')).toBe('hello')
  })

  it('nome só de símbolos → slug vazio (caller trata o fallback)', () => {
    expect(slugify('@#$%')).toBe('')
    expect(slugify('   ')).toBe('')
  })

  it('dígitos preservados', () => {
    expect(slugify('Chef 99')).toBe('chef-99')
  })
})

describe('handleBaseFromName (base válido pronto pra desambiguação)', () => {
  it('deriva o slug quando bem-formado', () => {
    expect(handleBaseFromName('Ana Júlia')).toBe('ana-julia')
  })

  it('slug vazio/curto → fallback estável "user"', () => {
    expect(handleBaseFromName('@#$%')).toBe('user')
    expect(handleBaseFromName('Jo')).toBe('user') // 2 chars < mínimo
  })

  it('base reservada → fallback "user"', () => {
    expect(handleBaseFromName('Admin')).toBe('user')
    expect(handleBaseFromName('API')).toBe('user')
  })

  it('trunca preservando folga pro sufixo; nunca estoura o máximo', () => {
    const longo = 'a'.repeat(60)
    const base = handleBaseFromName(longo)
    expect(base.length).toBeLessThanOrEqual(HANDLE_MAX_LEN)
    expect(base.length).toBeLessThan(HANDLE_MAX_LEN) // deixou folga pro -NN
  })
})

describe('disambiguate (base + handles tomados → primeiro livre)', () => {
  it('base livre → base puro', () => {
    expect(disambiguate('ana', new Set())).toBe('ana')
  })

  it('base tomado → anexa -2, -3, … até achar livre', () => {
    expect(disambiguate('ana', new Set(['ana']))).toBe('ana-2')
    expect(disambiguate('ana', new Set(['ana', 'ana-2']))).toBe('ana-3')
    expect(disambiguate('ana', new Set(['ana', 'ana-2', 'ana-3']))).toBe('ana-4')
  })

  it('pula candidatos reservados (fail-safe)', () => {
    // 'me' é reservado, então mesmo livre em `taken` ele não é escolhido como base.
    expect(disambiguate('me', new Set())).toBe('me-2')
  })

  it('resultado sempre dentro do máximo, mesmo com base no limite', () => {
    const base = 'a'.repeat(HANDLE_MAX_LEN)
    const out = disambiguate(base, new Set([base]))
    expect(out.length).toBeLessThanOrEqual(HANDLE_MAX_LEN)
    expect(out.endsWith('-2')).toBe(true)
  })
})

describe('validateHandle (formato + reservadas; sem unicidade)', () => {
  it('handles bem-formados → ok', () => {
    expect(validateHandle('ana')).toEqual({ ok: true })
    expect(validateHandle('ana-julia')).toEqual({ ok: true })
    expect(validateHandle('chef99')).toEqual({ ok: true })
    expect(validateHandle('a1b2c3')).toEqual({ ok: true })
  })

  it('curto/longo demais → invalid', () => {
    expect(validateHandle('ab')).toEqual({ ok: false, reason: 'invalid' })
    expect(validateHandle('a'.repeat(HANDLE_MAX_LEN + 1))).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('charset/forma inválidos → invalid', () => {
    expect(validateHandle('Ana')).toEqual({ ok: false, reason: 'invalid' }) // maiúscula
    expect(validateHandle('ana julia')).toEqual({ ok: false, reason: 'invalid' }) // espaço
    expect(validateHandle('ana_julia')).toEqual({ ok: false, reason: 'invalid' }) // underscore
    expect(validateHandle('-ana')).toEqual({ ok: false, reason: 'invalid' }) // hífen na borda
    expect(validateHandle('ana-')).toEqual({ ok: false, reason: 'invalid' })
    expect(validateHandle('an--a')).toEqual({ ok: false, reason: 'invalid' }) // duplo hífen
    expect(validateHandle('joão')).toEqual({ ok: false, reason: 'invalid' }) // não-ascii
  })

  it('palavra reservada → reserved', () => {
    expect(validateHandle('admin')).toEqual({ ok: false, reason: 'reserved' })
    expect(validateHandle('api')).toEqual({ ok: false, reason: 'reserved' })
    expect(validateHandle('users')).toEqual({ ok: false, reason: 'reserved' })
    expect(validateHandle('profile')).toEqual({ ok: false, reason: 'reserved' })
  })

  it('#470: prefixo `pendente-` (handle de espera) é reservado; `pendente` puro não', () => {
    expect(validateHandle('pendente-0123456789abcdef')).toEqual({ ok: false, reason: 'reserved' })
    expect(validateHandle('pendente-ana')).toEqual({ ok: false, reason: 'reserved' })
    expect(validateHandle('pendente')).toEqual({ ok: true })
    expect(validateHandle('ana-pendente-2')).toEqual({ ok: true })
  })

  it('#470: nenhum nome gera handle com o prefixo `pendente-` (nem pela desambiguação)', () => {
    for (const name of ['Pendente 0123456789abcdef', 'pendente-ana', 'Pendente', 'PENDENTE silva']) {
      const base = handleBaseFromName(name)
      expect(base.startsWith('pendente-')).toBe(false)
      const taken = new Set([base, `${base}-2`])
      expect(disambiguate(base, taken).startsWith('pendente-')).toBe(false)
    }
    expect(handleBaseFromName('Pendente')).toBe('user')
    expect(handleBaseFromName('Pendentes Reunidos')).toBe('pendentes-reunidos')
  })

  it('todas as reservadas batem com os segmentos de rota top-level', () => {
    // Sanidade: as rotas que existem hoje sob app/ estão barradas.
    for (const seg of ['admin', 'api', 'me', 'recipes', 'sign-in', 'sign-up', 'create', 'conversation']) {
      expect(RESERVED_HANDLES.has(seg)).toBe(true)
    }
  })
})
