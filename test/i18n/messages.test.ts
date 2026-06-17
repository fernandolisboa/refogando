import { describe, expect, it } from 'vitest'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import { MESSAGES } from '@/i18n/messages'

/** Caminhos profundos (dot-path) de todas as folhas string de um objeto aninhado. */
function deepKeyPaths(obj: unknown, prefix = ''): string[] {
  if (obj && typeof obj === 'object') {
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
      deepKeyPaths(v, prefix ? `${prefix}.${k}` : k),
    )
  }
  return [prefix]
}

/** Todas as folhas string de um objeto aninhado (para checar valores vazios). */
function deepStringValues(obj: unknown): string[] {
  if (obj && typeof obj === 'object') {
    return Object.values(obj as Record<string, unknown>).flatMap(deepStringValues)
  }
  return [String(obj)]
}

describe('Catálogos de chrome — paridade pt-BR / en-US (#4.AC1, T3)', () => {
  it('paridade recursiva de chaves: ptBR == enUS', () => {
    const ptKeys = deepKeyPaths(ptBR).sort()
    const enKeys = deepKeyPaths(enUS).sort()
    expect(enKeys).toEqual(ptKeys)
  })

  it('nenhum valor é vazio em pt-BR', () => {
    for (const v of deepStringValues(ptBR)) {
      expect(v.trim().length).toBeGreaterThan(0)
    }
  })

  it('nenhum valor é vazio em en-US', () => {
    for (const v of deepStringValues(enUS)) {
      expect(v.trim().length).toBeGreaterThan(0)
    }
  })

  it('MESSAGES cobre os dois locales e aponta para os catálogos canônicos', () => {
    expect(Object.keys(MESSAGES).sort()).toEqual(['en-US', 'pt-BR'])
    expect(MESSAGES['pt-BR']).toBe(ptBR)
    expect(MESSAGES['en-US']).toBe(enUS)
  })

  // #23 (C9): chaves novas de tradução (aviso de stale + ver-o-original) presentes e
  // não-vazias nos DOIS locales (a paridade recursiva acima já pega faltantes; aqui o
  // teste explícito documenta o contrato). O *render* (chave→texto) é provado em C4.
  it('#23 — traducao.staleAviso/verOriginal presentes e não-vazias nos dois locales', () => {
    for (const loc of ['pt-BR', 'en-US'] as const) {
      expect(MESSAGES[loc].traducao.staleAviso.trim().length).toBeGreaterThan(0)
      expect(MESSAGES[loc].traducao.verOriginal.trim().length).toBeGreaterThan(0)
    }
  })
})
