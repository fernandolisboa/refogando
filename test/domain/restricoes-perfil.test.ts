import { describe, it, expect } from 'vitest'
import {
  RESTRICOES_INPUT_MAX,
  SELECAO_INICIAL,
  SELECAO_LIMPA,
  alternarRestricao,
  normalizarRestricoes,
  ordenarRestricoes,
  parseListaRestricoes,
  buscaUsaPerfil,
  restricaoEhCriterio,
  restricoesDoPedido,
  restricoesEfetivas,
  restricoesExplicitasDaBusca,
  somarRestricoes,
  vemDoPerfil,
} from '@/domain/restricoes-perfil'
import { RESTRICOES } from '@/domain/vocabulary'

/**
 * Kernel PURO das Restrições salvas no perfil (ADR-0041): a validação da lista contra o vocabulário (zod), a
 * forma canônica gravada e a regra de "seleção com default" que a criação, o Cardápio e a Busca usam.
 */

describe('parseListaRestricoes (validação estrita)', () => {
  it('aceita valores do vocabulário e devolve a forma canônica (sem repetição, na ordem do vocabulário)', () => {
    expect(parseListaRestricoes(['vegano', 'sem_gluten', 'vegano'])).toEqual({
      ok: true,
      restricoes: ['sem_gluten', 'vegano'],
    })
  })

  it('lista vazia é válida (limpa o default)', () => {
    expect(parseListaRestricoes([])).toEqual({ ok: true, restricoes: [] })
  })

  it('qualquer valor fora do vocabulário recusa a lista INTEIRA (não descarta em silêncio)', () => {
    for (const bad of [['vegano', 'kosher'], ['Vegano'], ['sem glúten'], [42], [null]]) {
      expect(parseListaRestricoes(bad)).toEqual({ ok: false })
    }
  })

  it('não-array e ausente são recusados (cada borda decide o que ausente significa)', () => {
    for (const bad of ['vegano', { vegano: true }, null, undefined, 1]) {
      expect(parseListaRestricoes(bad)).toEqual({ ok: false })
    }
  })

  it('recusa payload inflado acima do teto, mesmo com valores válidos', () => {
    const inflado = Array.from({ length: RESTRICOES_INPUT_MAX + 1 }, () => 'vegano')
    expect(parseListaRestricoes(inflado)).toEqual({ ok: false })
    expect(parseListaRestricoes(inflado.slice(0, RESTRICOES_INPUT_MAX))).toEqual({
      ok: true,
      restricoes: ['vegano'],
    })
  })
})

describe('normalizarRestricoes (leitura tolerante) e ordenarRestricoes', () => {
  it('mantém só o vocabulário, sem lançar', () => {
    expect(normalizarRestricoes(['low_carb', 'desconhecida', 3, 'sem_lactose'])).toEqual(['sem_lactose', 'low_carb'])
    expect(normalizarRestricoes('vegano')).toEqual([])
    expect(normalizarRestricoes(undefined)).toEqual([])
  })

  it('ordenar é idempotente e segue a ordem de RESTRICOES', () => {
    const tudo = [...RESTRICOES].reverse()
    expect(ordenarRestricoes(tudo)).toEqual([...RESTRICOES])
    expect(ordenarRestricoes(ordenarRestricoes(tudo))).toEqual([...RESTRICOES])
  })
})

describe('seleção com default do perfil', () => {
  const perfil = ['sem_gluten', 'vegano'] as const

  it('sem toque, vale o perfil; perfil ausente (Visitante/carregando) ⇒ nada', () => {
    expect(restricoesEfetivas(SELECAO_INICIAL, [...perfil])).toEqual(['sem_gluten', 'vegano'])
    expect(restricoesEfetivas(SELECAO_INICIAL, null)).toEqual([])
  })

  it('o 1º toque parte do que vale agora e a seleção passa a ser da pessoa', () => {
    const tirou = alternarRestricao(SELECAO_INICIAL, [...perfil], 'vegano')
    expect(tirou).toEqual({ tocada: true, escolhidas: ['sem_gluten'] })
    // Perfil que muda depois (salvo em outra aba) não atropela a escolha feita.
    expect(restricoesEfetivas(tirou, ['low_carb'])).toEqual(['sem_gluten'])

    const pos = alternarRestricao(tirou, [...perfil], 'sem_lactose')
    expect(pos.escolhidas).toEqual(['sem_gluten', 'sem_lactose'])
  })

  it('tirar todas é uma escolha (não volta pro perfil)', () => {
    let sel = alternarRestricao(SELECAO_INICIAL, ['vegano'], 'vegano')
    expect(sel).toEqual({ tocada: true, escolhidas: [] })
    expect(restricoesEfetivas(sel, ['vegano'])).toEqual([])
    sel = SELECAO_LIMPA
    expect(restricoesEfetivas(sel, ['vegano'])).toEqual([])
  })

  it('vemDoPerfil só acende sem toque e com algo salvo', () => {
    expect(vemDoPerfil(SELECAO_INICIAL, ['vegano'])).toBe(true)
    expect(vemDoPerfil(SELECAO_INICIAL, [])).toBe(false)
    expect(vemDoPerfil(SELECAO_INICIAL, null)).toBe(false)
    expect(vemDoPerfil({ tocada: true, escolhidas: ['vegano'] }, ['vegano'])).toBe(false)
  })
})

describe('restricoesDoPedido: Prompt aberto e Conversa só oferecem as salvas', () => {
  it('sem toque, são as do perfil; Visitante/sem perfil, nenhuma', () => {
    expect(restricoesDoPedido(SELECAO_INICIAL, ['vegano', 'sem_gluten'])).toEqual(['vegano', 'sem_gluten'])
    expect(restricoesDoPedido(SELECAO_INICIAL, null)).toEqual([])
  })

  it('um toque herdado do estruturado fora do perfil NÃO sobe', () => {
    const sel = { tocada: true, escolhidas: ['vegano' as const, 'sem_lactose' as const] }
    expect(restricoesDoPedido(sel, ['vegano'])).toEqual(['vegano'])
  })
})

describe('restricaoEhCriterio: só a escolha da pessoa conta como substância', () => {
  it('o default intocado nunca conta (nem como critério da Busca, nem como briefing não-vazio)', () => {
    expect(restricaoEhCriterio(SELECAO_INICIAL)).toBe(false)
    expect(restricaoEhCriterio(SELECAO_LIMPA)).toBe(false)
    expect(restricaoEhCriterio({ tocada: true, escolhidas: ['sem_lactose'] })).toBe(true)
  })
})

describe('Busca (dec.3): o perfil vai como pedido ao servidor, nunca como valores na URL', () => {
  it('sem toque, o perfil é pedido só quando a pessoa refina', () => {
    expect(buscaUsaPerfil(SELECAO_INICIAL, false)).toBe(false)
    expect(buscaUsaPerfil(SELECAO_INICIAL, true)).toBe(true)
  })

  it('depois do toque (inclusive "Mostrar tudo"), não pede o perfil e valem só as escolhidas', () => {
    expect(buscaUsaPerfil(SELECAO_LIMPA, true)).toBe(false)
    expect(restricoesExplicitasDaBusca(SELECAO_LIMPA)).toEqual([])
    expect(restricoesExplicitasDaBusca({ tocada: true, escolhidas: ['sem_lactose'] })).toEqual(['sem_lactose'])
  })

  it('o default intocado NÃO é explícito (não vai à URL nem conta como faceta)', () => {
    expect(restricoesExplicitasDaBusca(SELECAO_INICIAL)).toEqual([])
  })

  it('servidor: soma as do perfil às da busca, na forma canônica', () => {
    expect(somarRestricoes(['vegano'], ['sem_gluten', 'vegano'])).toEqual(ordenarRestricoes(['vegano', 'sem_gluten']))
    expect(somarRestricoes([], [])).toEqual([])
  })
})
