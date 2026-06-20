import { describe, expect, it } from 'vitest'
import {
  LINKS_MAX,
  LINK_TIPOS,
  LINK_URL_MAX_LEN,
  safeHttpUrl,
  validateLinks,
} from '@/domain/links'

/**
 * Lógica PURA de links do perfil (#127) — sem DB, sem rede. Cobre a allowlist de tipos, o cap
 * de contagem, e a SEGURANÇA de esquema (só http(s); `javascript:`/`data:`/protocol-relative
 * são recusados). A persistência/borda é testada na integração; aqui só a forma e as regras.
 */

const httpsLink = (over: { tipo?: string; url?: string } = {}) => ({
  tipo: over.tipo ?? 'instagram',
  url: over.url ?? 'https://instagram.com/ana',
})

describe('safeHttpUrl (URL http(s) segura)', () => {
  it('aceita http e https bem-formados', () => {
    expect(safeHttpUrl('https://example.com')).toBe('https://example.com')
    expect(safeHttpUrl('http://example.com/path?q=1')).toBe('http://example.com/path?q=1')
  })

  it('trima whitespace de borda', () => {
    expect(safeHttpUrl('  https://example.com  ')).toBe('https://example.com')
  })

  it('recusa esquemas perigosos (case-insensitive)', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'DATA:text/html;base64,x',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ftp://example.com',
      'mailto:a@b.com',
      'tel:+5511999999999',
    ]) {
      expect(safeHttpUrl(bad)).toBeNull()
    }
  })

  it('recusa protocol-relative e caminhos relativos (sem esquema absoluto)', () => {
    expect(safeHttpUrl('//evil.com')).toBeNull()
    expect(safeHttpUrl('/caminho')).toBeNull()
    expect(safeHttpUrl('example.com')).toBeNull()
    expect(safeHttpUrl('www.example.com/x')).toBeNull()
  })

  it('recusa http(s) sem host', () => {
    expect(safeHttpUrl('https://')).toBeNull()
    expect(safeHttpUrl('http://')).toBeNull()
  })

  it('recusa vazia, só-espaços, não-string e acima do cap de tamanho', () => {
    expect(safeHttpUrl('')).toBeNull()
    expect(safeHttpUrl('   ')).toBeNull()
    expect(safeHttpUrl(42)).toBeNull()
    expect(safeHttpUrl(null)).toBeNull()
    expect(safeHttpUrl(undefined)).toBeNull()
    const gigante = 'https://example.com/' + 'a'.repeat(LINK_URL_MAX_LEN)
    expect(safeHttpUrl(gigante)).toBeNull()
  })
})

describe('validateLinks (lista completa)', () => {
  it('lista vazia é válida (remover todos os links)', () => {
    expect(validateLinks([])).toEqual({ ok: true, links: [] })
  })

  it('aceita uma lista válida com todos os tipos conhecidos', () => {
    const links = LINK_TIPOS.map((tipo) => ({ tipo, url: `https://${tipo}.example.com` }))
    const res = validateLinks(links)
    expect(res).toEqual({ ok: true, links })
  })

  it('normaliza a URL (trima) na saída', () => {
    const res = validateLinks([{ tipo: 'site', url: '  https://meu-site.com  ' }])
    expect(res).toEqual({ ok: true, links: [{ tipo: 'site', url: 'https://meu-site.com' }] })
  })

  it('acima de 5 links → too_many', () => {
    const seis = Array.from({ length: LINKS_MAX + 1 }, (_, i) => httpsLink({ url: `https://e${i}.com` }))
    expect(validateLinks(seis)).toEqual({ ok: false, reason: 'too_many' })
  })

  it('exatamente 5 links → ok', () => {
    const cinco = Array.from({ length: LINKS_MAX }, (_, i) => httpsLink({ url: `https://e${i}.com` }))
    expect(validateLinks(cinco).ok).toBe(true)
  })

  it('tipo desconhecido (string fora da allowlist) → unknown_tipo', () => {
    expect(validateLinks([httpsLink({ tipo: 'tiktok' })])).toEqual({
      ok: false,
      reason: 'unknown_tipo',
    })
    expect(validateLinks([httpsLink({ tipo: 'Instagram' })])).toEqual({
      ok: false,
      reason: 'unknown_tipo',
    })
  })

  it('URL de esquema perigoso → bad_url (vetor XSS no perfil público)', () => {
    expect(validateLinks([{ tipo: 'site', url: 'javascript:alert(1)' }])).toEqual({
      ok: false,
      reason: 'bad_url',
    })
    expect(validateLinks([{ tipo: 'site', url: 'data:text/html,<script>x</script>' }])).toEqual({
      ok: false,
      reason: 'bad_url',
    })
    expect(validateLinks([{ tipo: 'site', url: '//evil.com' }])).toEqual({
      ok: false,
      reason: 'bad_url',
    })
  })

  it('URL não-http (válida sintaticamente mas não http(s)) → bad_url', () => {
    expect(validateLinks([httpsLink({ url: 'ftp://example.com' })])).toEqual({
      ok: false,
      reason: 'bad_url',
    })
  })

  it('não-array → not_array', () => {
    expect(validateLinks({}).ok).toBe(false)
    expect(validateLinks('x')).toEqual({ ok: false, reason: 'not_array' })
    expect(validateLinks(null)).toEqual({ ok: false, reason: 'not_array' })
  })

  it('entrada malformada (não-objeto, tipo ausente, url não-string) → bad_entry', () => {
    expect(validateLinks(['x'])).toEqual({ ok: false, reason: 'bad_entry' })
    expect(validateLinks([{ url: 'https://x.com' }])).toEqual({ ok: false, reason: 'bad_entry' })
    expect(validateLinks([{ tipo: 'site' }])).toEqual({ ok: false, reason: 'bad_entry' })
    expect(validateLinks([{ tipo: 'site', url: 42 }])).toEqual({ ok: false, reason: 'bad_entry' })
    expect(validateLinks([null])).toEqual({ ok: false, reason: 'bad_entry' })
  })
})
