import { describe, expect, it } from 'vitest'
import {
  normalizeTakedownIntake,
  normalizeTakedownResolution,
  isTakedownRequestType,
  TAKEDOWN_FIELD_MAX,
  TAKEDOWN_MESSAGE_MAX,
} from '@/domain/takedown'

/**
 * Unit puro (#399, GAP-2) de `normalizeTakedownIntake` — a validação/sanitização do corpo do formulário
 * público de intake. Sem DB, sem I/O. Prova o contrato: mensagem obrigatória, ao menos um identificador
 * (URL ou nome), contato OPCIONAL, tipo com fallback `other`, strip C0 (anti-500) e cortes de tamanho.
 */

describe('isTakedownRequestType', () => {
  it('aceita os tipos conhecidos e rejeita o resto', () => {
    expect(isTakedownRequestType('name_removal')).toBe(true)
    expect(isTakedownRequestType('full_removal')).toBe(true)
    expect(isTakedownRequestType('other')).toBe(true)
    expect(isTakedownRequestType('DROP TABLE')).toBe(false)
    expect(isTakedownRequestType('')).toBe(false)
  })
})

describe('normalizeTakedownIntake (#399 — validacao do intake publico)', () => {
  it('pedido valido com URL -> ok; campos saneados/trim', () => {
    const r = normalizeTakedownIntake({
      requestType: 'name_removal',
      sourceUrl: '  https://site.com/receita  ',
      message: '  tire meu nome  ',
    })
    expect(r).toEqual({
      ok: true,
      value: {
        requestType: 'name_removal',
        sourceUrl: 'https://site.com/receita',
        displayName: null,
        message: 'tire meu nome',
        contactEmail: null,
      },
    })
  })

  it('identificacao pode ser SO o nome exibido (sem URL) -> ok', () => {
    const r = normalizeTakedownIntake({ displayName: 'Cozinha da Vovo', message: 'remover' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.displayName).toBe('Cozinha da Vovo')
      expect(r.value.sourceUrl).toBeNull()
    }
  })

  it('mensagem vazia (ou so espacos) -> pedido_obrigatorio', () => {
    expect(normalizeTakedownIntake({ sourceUrl: 'https://x.com', message: '   ' })).toEqual({
      ok: false,
      error: 'pedido_obrigatorio',
    })
    expect(normalizeTakedownIntake({ sourceUrl: 'https://x.com' })).toEqual({
      ok: false,
      error: 'pedido_obrigatorio',
    })
  })

  it('nenhum identificador (sem URL e sem nome) -> identificacao_obrigatoria', () => {
    expect(normalizeTakedownIntake({ message: 'quero remover' })).toEqual({
      ok: false,
      error: 'identificacao_obrigatoria',
    })
  })

  it('a mensagem e o erro PRIORITARIO: vazia vence a falta de identificador', () => {
    expect(normalizeTakedownIntake({})).toEqual({ ok: false, error: 'pedido_obrigatorio' })
  })

  it('tipo desconhecido/ausente -> fallback other (nunca rejeita por tipo)', () => {
    const r = normalizeTakedownIntake({ requestType: 'lixo', displayName: 'X', message: 'oi' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.requestType).toBe('other')
    const r2 = normalizeTakedownIntake({ displayName: 'X', message: 'oi' })
    if (r2.ok) expect(r2.value.requestType).toBe('other')
  })

  it('contato e OPCIONAL: ausente -> null; presente -> saneado', () => {
    const semContato = normalizeTakedownIntake({ displayName: 'X', message: 'oi' })
    if (semContato.ok) expect(semContato.value.contactEmail).toBeNull()
    const comContato = normalizeTakedownIntake({
      displayName: 'X',
      message: 'oi',
      contactEmail: '  a@b.com ',
    })
    if (comContato.ok) expect(comContato.value.contactEmail).toBe('a@b.com')
  })

  it('anti-500: bytes de controle C0 (NUL) viram espaco -> nao sobra NUL em nenhum campo', () => {
    const NUL = String.fromCharCode(0)
    const r = normalizeTakedownIntake({
      requestType: 'name_removal',
      sourceUrl: `https://x.com/${NUL}r`,
      displayName: `No${NUL}me`,
      message: `linha1${NUL}linha2`,
      contactEmail: `a${NUL}@b.com`,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const joined = JSON.stringify(r.value)
      expect(joined.includes(NUL)).toBe(false) // o NUL que estoura o postgres-js nao sobrevive
      expect(r.value.message).toBe('linha1 linha2') // C0 (NUL) -> espaco
    }
  })

  it('mensagem preserva \\n e \\t (textarea) mas remove NUL/\\r (anti-500)', () => {
    const NUL = String.fromCharCode(0)
    const r = normalizeTakedownIntake({
      displayName: 'X',
      message: `linha1\nlinha2\tcol${NUL}fim\r`,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // \n e \t sobrevivem (parágrafos do textarea); NUL -> espaço; \r -> espaço (trimado no fim).
      expect(r.value.message).toBe('linha1\nlinha2\tcol fim')
      expect(r.value.message.includes(NUL)).toBe(false)
    }
  })

  it('campos CURTOS (nome/url) continuam achatando \\n/\\t (só a mensagem preserva)', () => {
    const r = normalizeTakedownIntake({ displayName: 'linha1\nlinha2', message: 'oi' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.displayName).toBe('linha1 linha2') // C0 -> espaço no campo curto
  })

  it('campos nao-string sao ignorados (numero/objeto -> null, nunca crash)', () => {
    const r = normalizeTakedownIntake({
      sourceUrl: 123,
      displayName: { a: 1 },
      message: 'oi',
      contactEmail: [],
    })
    // sem identificador string valido -> identificacao_obrigatoria
    expect(r).toEqual({ ok: false, error: 'identificacao_obrigatoria' })
  })

  it('corta campos ao teto (anti-DoS): nome/URL a FIELD_MAX, mensagem a MESSAGE_MAX', () => {
    const r = normalizeTakedownIntake({
      displayName: 'a'.repeat(TAKEDOWN_FIELD_MAX + 50),
      message: 'b'.repeat(TAKEDOWN_MESSAGE_MAX + 50),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.displayName?.length).toBe(TAKEDOWN_FIELD_MAX)
      expect(r.value.message.length).toBe(TAKEDOWN_MESSAGE_MAX)
    }
  })
})

describe('normalizeTakedownResolution (encerramento pelo operador)', () => {
  it('aceita "fulfilled" sem motivo e descarta o motivo enviado', () => {
    expect(normalizeTakedownResolution({ resolution: 'fulfilled', reason: 'x' })).toEqual({
      ok: true,
      value: { resolution: 'fulfilled', reason: null },
    })
  })

  it('exige motivo na recusa (vazio/espaços/ausente → motivo_obrigatorio)', () => {
    for (const reason of [undefined, '', '   ', 42]) {
      expect(normalizeTakedownResolution({ resolution: 'rejected', reason })).toEqual({
        ok: false,
        error: 'motivo_obrigatorio',
      })
    }
  })

  it('recusa com motivo: saneia C0 e corta no teto', () => {
    const r = normalizeTakedownResolution({
      resolution: 'rejected',
      reason: `  não é o titular\u0000${'x'.repeat(TAKEDOWN_FIELD_MAX)}`,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.resolution).toBe('rejected')
    expect(r.value.reason).not.toContain('\u0000')
    expect(r.value.reason!.length).toBeLessThanOrEqual(TAKEDOWN_FIELD_MAX)
  })

  it('rejeita desfecho desconhecido (sem fallback)', () => {
    for (const resolution of [undefined, 'received', 'verified', 'DROP', 1]) {
      expect(normalizeTakedownResolution({ resolution })).toEqual({
        ok: false,
        error: 'desfecho_invalido',
      })
    }
  })
})
