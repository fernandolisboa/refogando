import { describe, it, expect } from 'vitest'
import {
  TRANSCRIPT_ROLES,
  TRANSCRIPT_MESSAGE_MAX,
  TRANSCRIPT_MAX_MESSAGES,
  parseTranscript,
  nextSeq,
  type TranscriptMessage,
} from '@/domain/transcript'
import { OBSERVACOES_MAX } from '@/domain/briefing'

/**
 * Domínio puro da Transcrição da conversa (#12): PURO/TOTAL/SEM THROW, sem DB. Espelha o
 * estilo de `parseBriefing` — discriminated union sem throw, devolve o PRIMEIRO erro. Cobre
 * shape ok, cada código de erro, os limites (comprimento/contagem) e a regra "última fala é
 * do usuário". (Não há pgEnum ainda — a tabela chega em #15.)
 */

function msg(overrides: Partial<TranscriptMessage> = {}): TranscriptMessage {
  return { role: 'user', content: 'arroz com queijo', ...overrides }
}

describe('TRANSCRIPT_ROLES / constantes', () => {
  it('TRANSCRIPT_ROLES é exatamente [user, assistant]', () => {
    expect([...TRANSCRIPT_ROLES]).toEqual(['user', 'assistant'])
  })
  it('TRANSCRIPT_MESSAGE_MAX é o mesmo OBSERVACOES_MAX (fonte única)', () => {
    expect(TRANSCRIPT_MESSAGE_MAX).toBe(OBSERVACOES_MAX)
  })
  it('TRANSCRIPT_MAX_MESSAGES é um teto positivo', () => {
    expect(TRANSCRIPT_MAX_MESSAGES).toBeGreaterThan(0)
  })
})

describe('parseTranscript — shape ok', () => {
  it('multi-turno válido terminando em user → ok', () => {
    const r = parseTranscript([
      { role: 'user', content: 'quero um bolo' },
      { role: 'assistant', content: 'de que sabor?' },
      { role: 'user', content: 'chocolate' },
    ])
    expect(r).toEqual({
      ok: true,
      transcript: [
        { role: 'user', content: 'quero um bolo' },
        { role: 'assistant', content: 'de que sabor?' },
        { role: 'user', content: 'chocolate' },
      ],
    })
  })

  it('um único turno do usuário → ok', () => {
    expect(parseTranscript([msg()])).toEqual({ ok: true, transcript: [msg()] })
  })
})

describe('parseTranscript — erros (devolve o PRIMEIRO)', () => {
  it('não-array → transcript_invalido', () => {
    expect(parseTranscript({}).ok).toBe(false)
    expect(parseTranscript({})).toMatchObject({ error: 'transcript_invalido' })
    expect(parseTranscript(null)).toMatchObject({ error: 'transcript_invalido' })
    expect(parseTranscript('oi')).toMatchObject({ error: 'transcript_invalido' })
  })

  it('vazio → transcript_vazio', () => {
    expect(parseTranscript([])).toMatchObject({ ok: false, error: 'transcript_vazio' })
  })

  it('item não-objeto → mensagem_invalida', () => {
    expect(parseTranscript(['oi'])).toMatchObject({ ok: false, error: 'mensagem_invalida' })
    expect(parseTranscript([null])).toMatchObject({ ok: false, error: 'mensagem_invalida' })
  })

  it('role fora do enum → mensagem_invalida', () => {
    expect(parseTranscript([{ role: 'system', content: 'x' }])).toMatchObject({
      ok: false,
      error: 'mensagem_invalida',
    })
  })

  it('content não-string ou vazio (após trim) → mensagem_invalida', () => {
    expect(parseTranscript([{ role: 'user', content: '' }])).toMatchObject({
      ok: false,
      error: 'mensagem_invalida',
    })
    expect(parseTranscript([{ role: 'user', content: '   ' }])).toMatchObject({
      ok: false,
      error: 'mensagem_invalida',
    })
    expect(parseTranscript([{ role: 'user', content: 123 }])).toMatchObject({
      ok: false,
      error: 'mensagem_invalida',
    })
  })

  it('última fala não é do usuário → ultima_fala_nao_usuario', () => {
    expect(
      parseTranscript([
        { role: 'user', content: 'oi' },
        { role: 'assistant', content: 'olá' },
      ]),
    ).toMatchObject({ ok: false, error: 'ultima_fala_nao_usuario' })
  })

  it('mensagem maior que o teto → mensagem_muito_longa', () => {
    expect(
      parseTranscript([{ role: 'user', content: 'a'.repeat(TRANSCRIPT_MESSAGE_MAX + 1) }]),
    ).toMatchObject({ ok: false, error: 'mensagem_muito_longa' })
  })

  it('comprimento no limite exato → ok', () => {
    expect(
      parseTranscript([{ role: 'user', content: 'a'.repeat(TRANSCRIPT_MESSAGE_MAX) }]).ok,
    ).toBe(true)
  })

  it('mensagens demais → transcript_muito_longo', () => {
    const tooMany = Array.from({ length: TRANSCRIPT_MAX_MESSAGES + 1 }, () => msg())
    expect(parseTranscript(tooMany)).toMatchObject({ ok: false, error: 'transcript_muito_longo' })
  })

  it('contagem no limite exato (terminando em user) → ok', () => {
    // Garante a última fala = user mantendo a contagem exata no teto.
    const exact: TranscriptMessage[] = Array.from({ length: TRANSCRIPT_MAX_MESSAGES }, (_, i) =>
      i % 2 === 0 ? { role: 'user', content: `u${i}` } : { role: 'assistant', content: `a${i}` },
    )
    // Força a última a ser do usuário (índice par garante; ajusta se o teto for par).
    exact[exact.length - 1] = { role: 'user', content: 'final do usuário' }
    expect(parseTranscript(exact).ok).toBe(true)
  })
})

describe('nextSeq — atribuição PURA de seq (#15)', () => {
  it('lista vazia → 0 (1ª fala)', () => {
    expect(nextSeq([])).toBe(0)
  })
  it('max + 1 (sequência contígua)', () => {
    expect(nextSeq([0, 1, 2, 3])).toBe(4)
  })
  it('max + 1 independe da ordem ou de buracos', () => {
    expect(nextSeq([3, 0, 2])).toBe(4)
    expect(nextSeq([0, 5])).toBe(6)
  })
  it('um único elemento → ele + 1', () => {
    expect(nextSeq([0])).toBe(1)
    expect(nextSeq([7])).toBe(8)
  })
})
