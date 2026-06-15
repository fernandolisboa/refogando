import { describe, expect, it } from 'vitest'
import {
  applyLocaleSideEffects,
  LOCALE_COOKIE,
  localeCookieValue,
  readLocaleCookie,
  type LocaleDocument,
} from '@/i18n/cookie'

describe('Cookie de locale do Visitante (#4.AC2, T4)', () => {
  it('readLocaleCookie extrai o valor de uma string de cookies', () => {
    expect(readLocaleCookie('locale=en-US')).toBe('en-US')
    expect(readLocaleCookie('foo=1; locale=pt-BR; bar=2')).toBe('pt-BR')
    // primeiro segmento da string.
    expect(readLocaleCookie('locale=pt-BR; other=x')).toBe('pt-BR')
  })

  it('readLocaleCookie devolve null quando o cookie locale não está presente', () => {
    expect(readLocaleCookie('')).toBeNull()
    expect(readLocaleCookie('foo=1; bar=2')).toBeNull()
    // não casa um nome que apenas contém "locale" como sufixo.
    expect(readLocaleCookie('mylocale=en-US')).toBeNull()
  })

  it('readLocaleCookie decodifica valores percent-encoded', () => {
    expect(readLocaleCookie(`locale=${encodeURIComponent('pt-BR')}`)).toBe('pt-BR')
  })

  it('round-trip: localeCookieValue grava algo que readLocaleCookie relê', () => {
    const cookie = localeCookieValue('en-US')
    // o navegador entregaria só o par nome=valor de volta em document.cookie.
    const nameValue = cookie.split(';')[0]
    expect(readLocaleCookie(nameValue)).toBe('en-US')
  })

  it('localeCookieValue carrega Path=/, SameSite=Lax e Max-Age (1 ano), sem HttpOnly', () => {
    const cookie = localeCookieValue('pt-BR')
    expect(cookie.startsWith(`${LOCALE_COOKIE}=`)).toBe(true)
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Max-Age=31536000')
    // cookie de locale é intencionalmente NÃO-HttpOnly (o client precisa lê-lo).
    expect(cookie).not.toContain('HttpOnly')
  })
})

describe('applyLocaleSideEffects — troca de locale sincroniza cookie E <html lang> (#4.AC1)', () => {
  function fakeDoc(lang = 'pt-BR'): LocaleDocument {
    return { cookie: '', documentElement: { lang } }
  }

  it('grava o cookie do Visitante (relegível por readLocaleCookie)', () => {
    const doc = fakeDoc()
    applyLocaleSideEffects(doc, 'en-US')
    // o navegador entregaria só o par nome=valor de volta em document.cookie.
    expect(readLocaleCookie(doc.cookie.split(';')[0])).toBe('en-US')
  })

  it('REGRESSÃO: sincroniza document.documentElement.lang com o locale escolhido', () => {
    // Bug original: trocar o idioma atualizava a chrome mas deixava `<html lang>` preso no
    // valor do SSR — lang divergia do idioma exibido. O sync DEVE acompanhar a troca.
    const doc = fakeDoc('en-US')
    applyLocaleSideEffects(doc, 'pt-BR')
    expect(doc.documentElement.lang).toBe('pt-BR')

    applyLocaleSideEffects(doc, 'en-US')
    expect(doc.documentElement.lang).toBe('en-US')
  })

  it('os dois efeitos andam juntos: cookie e lang refletem o MESMO locale', () => {
    const doc = fakeDoc()
    applyLocaleSideEffects(doc, 'en-US')
    expect(readLocaleCookie(doc.cookie.split(';')[0])).toBe('en-US')
    expect(doc.documentElement.lang).toBe('en-US')
  })
})
