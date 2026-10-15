import { describe, it, expect } from 'vitest'
import {
  NAV_SECTIONS,
  activeNav,
  matchesHref,
  parseLastTabs,
  sectionEntryHref,
  sectionsFor,
  tabsFor,
} from '@/domain/nav-sections'

/** Seções da navegação (ADR-0043) — o kernel puro: qual seção/aba está ativa e pra onde o link leva. */
const section = (id: string) => NAV_SECTIONS.find((s) => s.id === id)!

describe('matchesHref', () => {
  it('a home casa só com ela mesma', () => {
    expect(matchesHref('/', '/')).toBe(true)
    expect(matchesHref('/following', '/')).toBe(false)
  })

  it('as demais casam com a própria rota e as subrotas, não com prefixos soltos', () => {
    expect(matchesHref('/me/shopping-lists', '/me/shopping-lists')).toBe(true)
    expect(matchesHref('/me/shopping-lists/abc', '/me/shopping-lists')).toBe(true)
    expect(matchesHref('/me/recipesx', '/me/recipes')).toBe(false)
  })
})

describe('activeNav', () => {
  it.each([
    ['/', 'explorar', 'descobrir'],
    ['/following', 'explorar', 'seguindo'],
    ['/cooks', 'explorar', 'cozinheiros'],
    ['/me/recipes', 'minhasReceitas', 'criacoes'],
    ['/me/saved', 'minhasReceitas', 'salvos'],
    ['/me/meal-plan', 'planejar', 'cardapio'],
    ['/me/shopping-lists', 'planejar', 'listas'],
    ['/me/shopping-lists/0b5c', 'planejar', 'listas'],
    ['/me/pantry', 'planejar', 'despensa'],
  ])('%s ⇒ %s / %s', (rest, sectionId, tabId) => {
    const a = activeNav(rest)
    expect(a?.section.id).toBe(sectionId)
    expect(a?.tab.id).toBe(tabId)
  })

  it.each(['/recipes/arroz-x', '/u/ana', '/create', '/admin', '/guia', '/me/profile'])(
    '%s fica fora das seções',
    (rest) => {
      expect(activeNav(rest)).toBeNull()
    },
  )
})

describe('visibilidade', () => {
  it('Visitante: só Explorar, sem a aba Seguindo', () => {
    expect(sectionsFor(false).map((s) => s.id)).toEqual(['explorar'])
    expect(tabsFor(section('explorar'), false).map((t) => t.id)).toEqual(['descobrir', 'cozinheiros'])
  })

  it('logado: as 3 seções, com todas as abas', () => {
    expect(sectionsFor(true).map((s) => s.id)).toEqual(['explorar', 'minhasReceitas', 'planejar'])
    expect(tabsFor(section('explorar'), true).map((t) => t.id)).toEqual(['descobrir', 'seguindo', 'cozinheiros'])
  })
})

describe('sectionEntryHref', () => {
  it('sem lembrança, a 1ª aba', () => {
    expect(sectionEntryHref(section('planejar'), null)).toBe('/me/meal-plan')
    expect(sectionEntryHref(section('minhasReceitas'), undefined)).toBe('/me/recipes')
  })

  it('com lembrança válida, a aba lembrada', () => {
    expect(sectionEntryHref(section('planejar'), '/me/pantry')).toBe('/me/pantry')
  })

  it('lembrança que não é aba da seção é ignorada (nunca vira href)', () => {
    expect(sectionEntryHref(section('planejar'), '/me/saved')).toBe('/me/meal-plan')
    expect(sectionEntryHref(section('planejar'), 'https://evil.example')).toBe('/me/meal-plan')
  })

  it('Explorar não lembra: sempre a home', () => {
    expect(sectionEntryHref(section('explorar'), '/cooks')).toBe('/')
  })
})

describe('parseLastTabs', () => {
  it('lê só hrefs de aba da própria seção', () => {
    const raw = JSON.stringify({
      planejar: '/me/pantry',
      minhasReceitas: '/me/meal-plan',
      explorar: '/cooks',
      outra: '/x',
    })
    expect(parseLastTabs(raw)).toEqual({ planejar: '/me/pantry' })
  })

  it('nunca lança: vazio, JSON quebrado ou forma errada viram {}', () => {
    expect(parseLastTabs(null)).toEqual({})
    expect(parseLastTabs('{')).toEqual({})
    expect(parseLastTabs('"texto"')).toEqual({})
    expect(parseLastTabs('null')).toEqual({})
    expect(parseLastTabs(JSON.stringify({ planejar: 42 }))).toEqual({})
  })
})
