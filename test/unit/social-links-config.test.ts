import { describe, it, expect } from 'vitest'
import {
  parseSocialLinksConfig,
  DEFAULT_SOCIAL_LINKS_CONFIG,
  SOCIAL_LINKS_MAX,
  SOCIAL_LABEL_MAX_LEN,
} from '@/domain/social-links-config'

describe('parseSocialLinksConfig (#451)', () => {
  it('default é lista vazia', () => {
    expect(DEFAULT_SOCIAL_LINKS_CONFIG).toEqual([])
  })

  it('aceita lista vazia', () => {
    expect(parseSocialLinksConfig([])).toEqual({ ok: true, value: [] })
  })

  it('aceita links válidos preservando a ordem', () => {
    const r = parseSocialLinksConfig([
      { platform: 'instagram', url: 'https://instagram.com/refogando', enabled: true },
      { platform: 'youtube', url: 'https://youtube.com/@refogando', label: 'Nosso canal', enabled: false },
    ])
    expect(r).toEqual({
      ok: true,
      value: [
        { platform: 'instagram', url: 'https://instagram.com/refogando', enabled: true },
        { platform: 'youtube', url: 'https://youtube.com/@refogando', enabled: false, label: 'Nosso canal' },
      ],
    })
  })

  it('rejeita URL de esquema perigoso (XSS armazenado)', () => {
    expect(parseSocialLinksConfig([{ platform: 'x', url: 'javascript:alert(1)', enabled: true }])).toEqual({ ok: false })
    expect(parseSocialLinksConfig([{ platform: 'x', url: '//evil.com', enabled: true }])).toEqual({ ok: false })
    expect(parseSocialLinksConfig([{ platform: 'x', url: 'data:text/html,x', enabled: true }])).toEqual({ ok: false })
  })

  it('rejeita plataforma fora da allowlist', () => {
    expect(parseSocialLinksConfig([{ platform: 'myspace', url: 'https://myspace.com', enabled: true }])).toEqual({ ok: false })
  })

  it('rejeita plataforma duplicada', () => {
    expect(
      parseSocialLinksConfig([
        { platform: 'instagram', url: 'https://instagram.com/a', enabled: true },
        { platform: 'instagram', url: 'https://instagram.com/b', enabled: true },
      ]),
    ).toEqual({ ok: false })
  })

  it('rejeita mais de SOCIAL_LINKS_MAX entradas', () => {
    const many = Array.from({ length: SOCIAL_LINKS_MAX + 1 }, (_, i) => ({
      platform: 'instagram',
      url: `https://instagram.com/${i}`,
      enabled: true,
    }))
    expect(parseSocialLinksConfig(many).ok).toBe(false)
  })

  it('rejeita enabled ausente ou não-boolean', () => {
    expect(parseSocialLinksConfig([{ platform: 'x', url: 'https://x.com/a' }]).ok).toBe(false)
    expect(parseSocialLinksConfig([{ platform: 'x', url: 'https://x.com/a', enabled: 'yes' }]).ok).toBe(false)
  })

  it('label vazio/só-espaço vira omitido; label acima do teto é rejeitado', () => {
    const empty = parseSocialLinksConfig([{ platform: 'x', url: 'https://x.com/a', label: '   ', enabled: true }])
    expect(empty).toEqual({ ok: true, value: [{ platform: 'x', url: 'https://x.com/a', enabled: true }] })
    const tooLong = parseSocialLinksConfig([
      { platform: 'x', url: 'https://x.com/a', label: 'a'.repeat(SOCIAL_LABEL_MAX_LEN + 1), enabled: true },
    ])
    expect(tooLong.ok).toBe(false)
  })

  it('rejeita entrada não-objeto', () => {
    expect(parseSocialLinksConfig(['nope']).ok).toBe(false)
    expect(parseSocialLinksConfig('not an array').ok).toBe(false)
  })
})
