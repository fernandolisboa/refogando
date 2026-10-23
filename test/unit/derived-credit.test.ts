import { describe, expect, it } from 'vitest'
import {
  decideDerivedCredit,
  needsDerivedCreditLookup,
  type DerivedCreditInput,
} from '@/domain/derived-credit'

/**
 * Crédito público na Receita derivada (#610, ADR-0052) — a decisão pura: quando a página mostra "Baseada na receita
 * <título> de @handle" (ou "do catálogo"), e quando o dono da base vê "Retirar meu nome" / "Mostrar meu nome de novo".
 */

const BASE_ID = '11111111-1111-4111-8111-111111111111'
const ANA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' // dona da base
const BIA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' // dona da derivada

function input(over: {
  derived?: Partial<DerivedCreditInput['derived']>
  base?: Partial<NonNullable<DerivedCreditInput['base']>> | null
  baseOwner?: Partial<NonNullable<DerivedCreditInput['baseOwner']>> | null
  locale?: string
  viewerId?: string
} = {}): DerivedCreditInput {
  return {
    derived: {
      ownerId: BIA,
      lineageKind: 'edited',
      parentRecipeId: BASE_ID,
      creditRemovedAt: null,
      ...over.derived,
    },
    base:
      over.base === null
        ? null
        : {
            id: BASE_ID,
            ownerId: ANA,
            visibility: 'public',
            resultKind: 'success',
            moderationRemovedAt: null,
            curationStatus: 'not_required',
            origin: 'ai_chat',
            originalLocale: 'pt-BR',
            translations: [{ locale: 'pt-BR', titulo: 'Moqueca baiana', provenance: 'escrita_por_pessoa' }],
            slugNoLocale: 'moqueca-baiana',
            ...over.base,
          },
    baseOwner:
      over.baseOwner === null
        ? null
        : { handle: 'ana', publicAccount: true, creditOnDerivatives: true, ...over.baseOwner },
    locale: over.locale ?? 'pt-BR',
    ...(over.viewerId ? { viewerId: over.viewerId } : {}),
  }
}

describe('decideDerivedCredit — o crédito público', () => {
  it('derivada pública de receita pública de outra pessoa ⇒ título, link pelo slug e @ do dono da base', () => {
    expect(decideDerivedCredit(input())).toEqual({
      basedOn: { titulo: 'Moqueca baiana', href: '/pt-BR/recipes/moqueca-baiana', author: { handle: 'ana' } },
    })
  })

  it('sem slug no locale pedido ⇒ link pelo uuid (o fallback dos cards da Busca)', () => {
    const d = decideDerivedCredit(input({ base: { slugNoLocale: null }, locale: 'en-US' }))
    expect(d.basedOn?.href).toBe(`/en-US/recipes/${BASE_ID}`)
  })

  it('título segue resolveName: original primário, "(Tradução)" só com tradução confiável e diferente', () => {
    const confiavel = decideDerivedCredit(
      input({
        locale: 'en-US',
        base: {
          translations: [
            { locale: 'pt-BR', titulo: 'Moqueca baiana', provenance: 'escrita_por_pessoa' },
            { locale: 'en-US', titulo: 'Bahian fish stew', provenance: 'automatica_revisada' },
          ],
        },
      }),
    )
    expect(confiavel.basedOn?.titulo).toBe('Moqueca baiana (Bahian fish stew)')
    const naoRevisada = decideDerivedCredit(
      input({
        locale: 'en-US',
        base: {
          translations: [
            { locale: 'pt-BR', titulo: 'Moqueca baiana', provenance: 'escrita_por_pessoa' },
            { locale: 'en-US', titulo: 'Bahian fish stew', provenance: 'automatica_nao_revisada' },
          ],
        },
      }),
    )
    expect(naoRevisada.basedOn?.titulo).toBe('Moqueca baiana')
  })

  it('base de catálogo aprovada ⇒ crédito "do catálogo" (sem author)', () => {
    const d = decideDerivedCredit(
      input({ base: { ownerId: null, visibility: 'private', curationStatus: 'approved' }, baseOwner: null }),
    )
    expect(d.basedOn).toEqual({ titulo: 'Moqueca baiana', href: '/pt-BR/recipes/moqueca-baiana' })
  })

  it.each([
    ['base privada', { base: { visibility: 'private' } }],
    ['base playful', { base: { resultKind: 'playful' } }],
    ['base removida pela moderação', { base: { moderationRemovedAt: new Date() } }],
    ['rascunho de catálogo', { base: { ownerId: null, visibility: 'private', curationStatus: 'pending' }, baseOwner: null }],
    ['base importada da web', { base: { origin: 'web_imported' } }],
    ['base sumiu', { base: null }],
    ['base sem título', { base: { translations: [] } }],
    ['ponteiro diferente do pai lido', { base: { id: '22222222-2222-4222-8222-222222222222' } }],
    ['conta do dono da base não é pública (desativada/eliminada)', { baseOwner: { publicAccount: false } }],
    ['dono da base desligou o crédito', { baseOwner: { creditOnDerivatives: false } }],
    ['dono da base sem linha em users', { baseOwner: null }],
    ['mesmo dono na base e na derivada', { derived: { ownerId: ANA } }],
    ['dono da base retirou o nome desta derivada', { derived: { creditRemovedAt: new Date() } }],
    ['não é derivada (regeneração)', { derived: { lineageKind: 'regenerated' } }],
    ['base apagada (FK set null)', { derived: { parentRecipeId: null } }],
  ] as const)('%s ⇒ sem crédito', (_nome, over) => {
    expect(decideDerivedCredit(input(over as Parameters<typeof input>[0])).basedOn).toBeUndefined()
  })
})

describe('decideDerivedCredit — o controle do dono da base', () => {
  it('o dono da base lendo, com o nome na página ⇒ { exibir: true }', () => {
    expect(decideDerivedCredit(input({ viewerId: ANA })).creditoDoAutor).toEqual({ exibir: true })
  })

  it('o dono da base lendo, depois de retirar ⇒ { exibir: false } e nenhum crédito público', () => {
    const d = decideDerivedCredit(input({ viewerId: ANA, derived: { creditRemovedAt: new Date() } }))
    expect(d).toEqual({ creditoDoAutor: { exibir: false } })
  })

  it('retirado e base já privada ⇒ ainda dá para desfazer', () => {
    const d = decideDerivedCredit(
      input({ viewerId: ANA, derived: { creditRemovedAt: new Date() }, base: { visibility: 'private' } }),
    )
    expect(d.creditoDoAutor).toEqual({ exibir: false })
  })

  it('crédito valendo mas fora da página (opt-out global) ⇒ nada a retirar, sem controle', () => {
    const d = decideDerivedCredit(input({ viewerId: ANA, baseOwner: { creditOnDerivatives: false } }))
    expect(d).toEqual({})
  })

  it.each([
    ['anônimo', undefined],
    ['a dona da derivada', BIA],
    ['outra pessoa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
  ])('%s ⇒ sem controle', (_nome, viewerId) => {
    expect(decideDerivedCredit(input(viewerId ? { viewerId } : {})).creditoDoAutor).toBeUndefined()
  })
})

describe('needsDerivedCreditLookup', () => {
  const derivada = { ownerId: BIA, lineageKind: 'edited' as const, parentRecipeId: BASE_ID, creditRemovedAt: null }

  it('só derivada com pai; crédito retirado só pede a consulta quando há leitor', () => {
    expect(needsDerivedCreditLookup(derivada)).toBe(true)
    expect(needsDerivedCreditLookup({ ...derivada, lineageKind: null })).toBe(false)
    expect(needsDerivedCreditLookup({ ...derivada, parentRecipeId: null })).toBe(false)
    expect(needsDerivedCreditLookup({ ...derivada, creditRemovedAt: new Date() })).toBe(false)
    expect(needsDerivedCreditLookup({ ...derivada, creditRemovedAt: new Date() }, ANA)).toBe(true)
  })
})
