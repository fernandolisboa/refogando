import { describe, it, expect } from 'vitest'
import {
  encodeRecsCursor,
  decodeRecsCursor,
  encodeSearchCursor,
  decodeSearchCursor,
} from '@/domain/cooks-cursor'

/**
 * Cursores keyset da Descoberta de Cozinheiros (#308). O ponto crítico: decodificar é a BORDA de uma
 * rota pública — qualquer `?cursor=` adulterado tem que virar `null` (primeira página), NUNCA um valor
 * que estoure o cast/bind no SQL (500). E o `id` interno NUNCA entra no cursor (allowlist #269) — o
 * tiebreak é sempre o `handle` público.
 */
describe('cooks-cursor — recomendações (score, recency, handle)', () => {
  it('round-trip preserva os campos', () => {
    const c = { score: 42, recency: '2026-06-29 12:00:00+00', handle: 'ana-cozinha' }
    expect(decodeRecsCursor(encodeRecsCursor(c))).toEqual(c)
  })

  it('aceita recency com fração e offsets variados', () => {
    for (const r of ['2026-06-29 12:00:00.123456+00', '2026-06-29T12:00:00Z', '2026-06-29 09:00:00-0300']) {
      expect(decodeRecsCursor(encodeRecsCursor({ score: 0, recency: r, handle: 'h-1' }))?.recency).toBe(r)
    }
  })

  it('score 0 é válido (cozinheiro sem votos ainda)', () => {
    expect(decodeRecsCursor(encodeRecsCursor({ score: 0, recency: '2026-06-29 12:00:00+00', handle: 'h-1' }))).not.toBeNull()
  })

  // #368: o score da Popularidade é FLOAT (mistura Bayesiana), não mais int — o decoder aceita
  // qualquer número FINITO (fração e magnitudes grandes são válidas; só o não-finito/não-número é
  // rejeitado). A coluna alvo é float8, então "overflow int4" deixou de ser um problema.
  it.each([
    ['fração (score Bayesiano)', 1.5],
    ['negativo', -0.25],
    ['magnitude grande (era "overflow int4")', 9999999999],
  ])('score float finito (%s) é válido → decodifica', (_label, s) => {
    const raw = Buffer.from(JSON.stringify({ s, r: '2026-06-29 12:00:00+00', h: 'h-1' }), 'utf8').toString('base64url')
    expect(decodeRecsCursor(raw)).toEqual({ score: s, recency: '2026-06-29 12:00:00+00', handle: 'h-1' })
  })

  it.each([
    ['base64 lixo', '!!!not-base64!!!'],
    ['vazio', ''],
    ['json não-objeto', Buffer.from('"x"', 'utf8').toString('base64url')],
    ['score não-número', Buffer.from(JSON.stringify({ s: '1', r: '2026-06-29 12:00:00+00', h: 'h-1' }), 'utf8').toString('base64url')],
    // 1e999 é JSON válido que JSON.parse resolve como Infinity → Number.isFinite false → null (nunca bind).
    ['score não-finito (1e999→Infinity)', Buffer.from('{"s":1e999,"r":"2026-06-29 12:00:00+00","h":"h-1"}', 'utf8').toString('base64url')],
    ['recency não-timestamptz', Buffer.from(JSON.stringify({ s: 1, r: 'lixo', h: 'h-1' }), 'utf8').toString('base64url')],
    ['handle fora do charset', Buffer.from(JSON.stringify({ s: 1, r: '2026-06-29 12:00:00+00', h: 'Ana Maria!' }), 'utf8').toString('base64url')],
    ['data fora de faixa (mês 99)', Buffer.from(JSON.stringify({ s: 1, r: '9999-99-99 99:99:99', h: 'h-1' }), 'utf8').toString('base64url')],
  ])('forjado (%s) → null (nunca 500)', (_label, raw) => {
    expect(decodeRecsCursor(raw)).toBeNull()
  })

  it('null/garbage não lança', () => {
    expect(decodeRecsCursor(null)).toBeNull()
  })
})

describe('cooks-cursor — busca (rank, name, handle)', () => {
  it('round-trip preserva os campos, incl. name com unicode e o delimitador "|"', () => {
    const c = { rank: 2, name: 'José | Café à la "Maçã"', handle: 'jose-cafe' }
    expect(decodeSearchCursor(encodeSearchCursor(c))).toEqual(c)
  })

  it.each([
    ['rank não-inteiro', Buffer.from(JSON.stringify({ k: 0.5, n: 'x', h: 'h-1' }), 'utf8').toString('base64url')],
    ['name não-string', Buffer.from(JSON.stringify({ k: 0, n: 7, h: 'h-1' }), 'utf8').toString('base64url')],
    ['name gigante', Buffer.from(JSON.stringify({ k: 0, n: 'x'.repeat(1025), h: 'h-1' }), 'utf8').toString('base64url')],
    ['handle fora do charset', Buffer.from(JSON.stringify({ k: 0, n: 'x', h: 'WAT.' }), 'utf8').toString('base64url')],
    ['rank fora da faixa int4 (overflow)', Buffer.from(JSON.stringify({ k: 9999999999, n: 'x', h: 'h-1' }), 'utf8').toString('base64url')],
  ])('forjado (%s) → null', (_label, raw) => {
    expect(decodeSearchCursor(raw)).toBeNull()
  })

  it('name com control char (NUL) → null (nunca chega ao bind)', () => {
    const raw = Buffer.from(JSON.stringify({ k: 0, n: `a${String.fromCharCode(0)}b`, h: 'h-1' }), 'utf8').toString('base64url')
    expect(decodeSearchCursor(raw)).toBeNull()
  })

  it('o cursor codificado NUNCA contém o id interno — só os campos públicos', () => {
    const enc = encodeSearchCursor({ rank: 1, name: 'Ana', handle: 'ana' })
    const decoded = Buffer.from(enc, 'base64url').toString('utf8')
    expect(decoded).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i) // sem UUID
    expect(JSON.parse(decoded)).toEqual({ k: 1, n: 'Ana', h: 'ana' }) // só k/n/h
  })
})
