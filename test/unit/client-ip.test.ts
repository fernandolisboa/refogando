import { describe, it, expect } from 'vitest'
import { clientIpFromHeaders } from '@/server/http/params'

/**
 * Fonte de IP do rate-limit (hardening pós #449/#464). O 1º hop do `x-forwarded-for` é CONTROLADO pelo
 * cliente (na Vercel a edge appenda o IP real ao FIM), então prefirir `x-real-ip` (setado pela edge, não
 * sobrescrevível). Prova: x-real-ip vence; XFF forjado com x-real-ip presente NÃO muda a chave; fallback
 * para XFF só quando x-real-ip ausente; cap de comprimento; null quando nenhum header traz IP.
 */
function req(headers: Record<string, string>): Request {
  return new Request('http://localhost/x', { headers })
}

describe('clientIpFromHeaders — fonte de IP não-forjável', () => {
  it('prefere x-real-ip sobre x-forwarded-for', () => {
    expect(
      clientIpFromHeaders(req({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.9' })),
    ).toBe('203.0.113.7')
  })

  it('XFF forjado pelo cliente NÃO muda a chave quando x-real-ip está presente', () => {
    // O atacante escolhe o 1º hop do XFF; a chave deve ignorá-lo e usar o x-real-ip da edge.
    const real = clientIpFromHeaders(
      req({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' }),
    )
    const forgedDifferently = clientIpFromHeaders(
      req({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '9.9.9.9, 8.8.8.8' }),
    )
    expect(real).toBe('203.0.113.7')
    expect(forgedDifferently).toBe('203.0.113.7') // mesma chave apesar do XFF diferente
  })

  it('cai no 1º hop do x-forwarded-for quando x-real-ip está ausente', () => {
    expect(clientIpFromHeaders(req({ 'x-forwarded-for': '198.51.100.9, 10.0.0.1' }))).toBe(
      '198.51.100.9',
    )
  })

  it('capa o comprimento (anti-chave-abusiva)', () => {
    const long = 'a'.repeat(200)
    expect(clientIpFromHeaders(req({ 'x-real-ip': long }))!.length).toBe(64)
  })

  it('null quando nenhum header traz IP', () => {
    expect(clientIpFromHeaders(req({}))).toBeNull()
    expect(clientIpFromHeaders(req({ 'x-real-ip': '   ' }))).toBeNull()
  })
})
