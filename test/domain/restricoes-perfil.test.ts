import { describe, it, expect } from 'vitest'
import {
  RESTRICOES_INPUT_MAX,
  SELECAO_INICIAL,
  SELECAO_LIMPA,
  alternarRestricao,
  normalizarRestricoes,
  ordenarRestricoes,
  parseListaRestricoes,
  restricaoEhCriterio,
  restricoesDaBusca,
  restricoesEfetivas,
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

describe('Busca (dec.4): o perfil filtra só quando a pessoa refina', () => {
  it('no repouso (sem outro critério) o perfil NÃO filtra e nem conta como critério', () => {
    expect(restricoesDaBusca(SELECAO_INICIAL, ['vegano'], false)).toEqual([])
    expect(restricaoEhCriterio(SELECAO_INICIAL)).toBe(false)
  })

  it('com termo/faceta, o perfil entra como filtro default', () => {
    expect(restricoesDaBusca(SELECAO_INICIAL, ['vegano'], true)).toEqual(['vegano'])
    expect(restricoesDaBusca(SELECAO_INICIAL, null, true)).toEqual([])
  })

  it('a escolha da pessoa vale sempre — inclusive "Mostrar tudo" (vazia) e no repouso', () => {
    expect(restricoesDaBusca(SELECAO_LIMPA, ['vegano'], true)).toEqual([])
    const escolhida = { tocada: true, escolhidas: ['sem_lactose' as const] }
    expect(restricoesDaBusca(escolhida, ['vegano'], false)).toEqual(['sem_lactose'])
    expect(restricaoEhCriterio(escolhida)).toBe(true)
    expect(restricaoEhCriterio(SELECAO_LIMPA)).toBe(false)
  })
})
