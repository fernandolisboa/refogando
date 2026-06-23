import { describe, expect, it } from 'vitest'
import {
  RECIPE_SLUG_MAX_LEN,
  recipeSlugBaseFromTitle,
  disambiguateSlug,
  slugifyRecipeTitle,
  freezeSlug,
  computeSlugBackfill,
  type TranslationSlugRow,
} from '@/domain/recipe-slug'

/**
 * Lógica PURA do Slug por idioma (#229, ADR-0020) — sem DB, sem React. Cobre a normalização
 * (slugify), o fallback de base, a desambiguação numérica determinística e a regra de
 * CONGELAMENTO (um slug existente NÃO muda quando o título é revisado/renomeado; en-US congela
 * a partir do título da tradução-máquina INICIAL). A unicidade real por (locale) — a consulta
 * ao banco — é coberta na integração (CI); aqui só a forma e as regras puras.
 *
 * Roda no projeto "ui" (jsdom, sem DB) por importar só o módulo de domínio puro: fica verde
 * localmente sem Postgres/Docker.
 */

describe('slugifyRecipeTitle (título → slug normalizado)', () => {
  it('minúsculas + acentos dobrados pra ascii', () => {
    expect(slugifyRecipeTitle('Bolo de Cenoura')).toBe('bolo-de-cenoura')
    expect(slugifyRecipeTitle('Pão de Açúcar')).toBe('pao-de-acucar')
    expect(slugifyRecipeTitle('FEIJOADA')).toBe('feijoada')
  })

  it('só [a-z0-9-]: símbolos/espaços/_ viram hífen, colapsado e aparado', () => {
    expect(slugifyRecipeTitle('  Carrot   Cake  ')).toBe('carrot-cake')
    expect(slugifyRecipeTitle('Mac & Cheese')).toBe('mac-cheese')
    expect(slugifyRecipeTitle('Risoto_de Funghi!!')).toBe('risoto-de-funghi')
    expect(slugifyRecipeTitle('--Torta--')).toBe('torta')
  })

  it('preserva dígitos (úteis em títulos)', () => {
    expect(slugifyRecipeTitle('Bolo 3 Leites')).toBe('bolo-3-leites')
  })

  it('título só de símbolos/acentos sem ascii → string vazia (caller faz o fallback)', () => {
    expect(slugifyRecipeTitle('!!!')).toBe('')
    expect(slugifyRecipeTitle('   ')).toBe('')
    // CJK não vira ascii: slugifica para vazio, o base aplica o fallback.
    expect(slugifyRecipeTitle('寿司')).toBe('')
  })

  it('é determinístico: a mesma entrada sempre dá a mesma saída', () => {
    expect(slugifyRecipeTitle('Açaí na Tigela')).toBe(slugifyRecipeTitle('Açaí na Tigela'))
  })
})

describe('recipeSlugBaseFromTitle (título → base bem-formado, pronto pra desambiguar)', () => {
  it('slugifica e respeita o teto de tamanho, sem hífen na borda final', () => {
    const longTitle = 'a'.repeat(RECIPE_SLUG_MAX_LEN + 50)
    const base = recipeSlugBaseFromTitle(longTitle)
    expect(base.length).toBeLessThanOrEqual(RECIPE_SLUG_MAX_LEN)
    expect(base.endsWith('-')).toBe(false)
  })

  it('título vazio/só-símbolos cai num fallback estável e não-vazio', () => {
    expect(recipeSlugBaseFromTitle('!!!')).toBe('receita')
    expect(recipeSlugBaseFromTitle('   ')).toBe('receita')
    expect(recipeSlugBaseFromTitle('寿司')).toBe('receita')
  })

  it('trunca preservando folga pro sufixo de desambiguação (não estoura ao anexar -NN)', () => {
    const base = recipeSlugBaseFromTitle('palavra-'.repeat(40))
    // base + um sufixo grande continua dentro do teto
    expect(`${base}-9999`.length).toBeLessThanOrEqual(RECIPE_SLUG_MAX_LEN)
  })
})

describe('disambiguateSlug (base + tomados → primeiro livre, determinístico)', () => {
  it('base livre → retorna o próprio base', () => {
    expect(disambiguateSlug('bolo-de-cenoura', new Set())).toBe('bolo-de-cenoura')
  })

  it('base tomado → primeiro sufixo -1, -2, ... livre (determinístico)', () => {
    expect(disambiguateSlug('bolo', new Set(['bolo']))).toBe('bolo-1')
    expect(disambiguateSlug('bolo', new Set(['bolo', 'bolo-1']))).toBe('bolo-2')
    expect(disambiguateSlug('bolo', new Set(['bolo', 'bolo-1', 'bolo-2']))).toBe('bolo-3')
  })

  it('preenche buracos na sequência de forma determinística (menor sufixo livre)', () => {
    // bolo e bolo-2 tomados, bolo-1 livre → escolhe bolo-1
    expect(disambiguateSlug('bolo', new Set(['bolo', 'bolo-2']))).toBe('bolo-1')
  })

  it('mesma entrada → mesma saída (determinismo total, sem aleatório/timestamp)', () => {
    const taken = new Set(['bolo', 'bolo-1'])
    expect(disambiguateSlug('bolo', taken)).toBe(disambiguateSlug('bolo', new Set(['bolo', 'bolo-1'])))
  })

  it('encurta o base se base + sufixo estourar o teto, mantendo o slug válido', () => {
    const base = 'x'.repeat(RECIPE_SLUG_MAX_LEN)
    const out = disambiguateSlug(base, new Set([base]))
    expect(out.length).toBeLessThanOrEqual(RECIPE_SLUG_MAX_LEN)
    expect(out.endsWith('-1')).toBe(true)
  })
})

describe('freezeSlug — congelamento (estabilidade > beleza)', () => {
  it('se já existe um slug congelado, mantém — renomear/revisar NÃO muda a URL', () => {
    // Título novo seria "novo-titulo", mas o slug existente é "titulo-antigo": preserva.
    expect(freezeSlug({ existingSlug: 'titulo-antigo', title: 'Novo Título', taken: new Set() })).toBe(
      'titulo-antigo',
    )
  })

  it('sem slug existente, deriva do título atual e desambigua (1ª vez — o congelamento)', () => {
    expect(freezeSlug({ existingSlug: null, title: 'Carrot Cake', taken: new Set() })).toBe('carrot-cake')
    expect(
      freezeSlug({ existingSlug: null, title: 'Carrot Cake', taken: new Set(['carrot-cake']) }),
    ).toBe('carrot-cake-1')
  })

  it('existingSlug vazio/undefined é tratado como ausente (deriva e congela agora)', () => {
    expect(freezeSlug({ existingSlug: '', title: 'Bolo', taken: new Set() })).toBe('bolo')
    expect(freezeSlug({ existingSlug: undefined, title: 'Bolo', taken: new Set() })).toBe('bolo')
  })

  it('en-US congela a partir do título da MT inicial: o slug não muda quando a tradução é revisada', () => {
    // 1ª MT: "Carrot Cake" → congela "carrot-cake". Revisão humana muda o título exibido para
    // "Best Carrot Cake Ever", mas como já há slug, ele NÃO re-deriva.
    const frozen = freezeSlug({ existingSlug: null, title: 'Carrot Cake', taken: new Set() })
    expect(frozen).toBe('carrot-cake')
    const afterRevision = freezeSlug({
      existingSlug: frozen,
      title: 'Best Carrot Cake Ever',
      taken: new Set(),
    })
    expect(afterRevision).toBe('carrot-cake')
  })
})

describe('computeSlugBackfill — núcleo puro do backfill (idempotente, determinístico, por locale)', () => {
  const row = (
    id: string,
    locale: string,
    titulo: string,
    slug: string | null = null,
  ): TranslationSlugRow => ({ id, locale, titulo, slug })

  it('atribui slug só às linhas NULL, derivado do título, preservando as já preenchidas', () => {
    const rows = [
      row('a', 'pt-BR', 'Bolo de Cenoura'),
      row('b', 'pt-BR', 'Feijoada', 'feijoada-fixa'), // já tem slug → preservada
    ]
    const out = computeSlugBackfill(rows)
    expect(out).toEqual([{ id: 'a', locale: 'pt-BR', slug: 'bolo-de-cenoura' }])
  })

  it('desambigua DENTRO do locale com sufixo numérico determinístico', () => {
    const rows = [
      row('a', 'pt-BR', 'Bolo'),
      row('b', 'pt-BR', 'Bolo'),
      row('c', 'pt-BR', 'Bolo'),
    ]
    const out = computeSlugBackfill(rows)
    expect(out.map((x) => x.slug)).toEqual(['bolo', 'bolo-1', 'bolo-2'])
  })

  it('o escopo de unicidade é POR locale: o mesmo slug em pt-BR e en-US não colide', () => {
    const rows = [row('a', 'pt-BR', 'Cake'), row('b', 'en-US', 'Cake')]
    const out = computeSlugBackfill(rows)
    expect(out).toEqual([
      { id: 'a', locale: 'pt-BR', slug: 'cake' },
      { id: 'b', locale: 'en-US', slug: 'cake' },
    ])
  })

  it('respeita slugs já gravados ao desambiguar (semeia o taken — colisão com existente pula)', () => {
    const rows = [
      row('a', 'pt-BR', 'Bolo', 'bolo'), // existente
      row('b', 'pt-BR', 'Bolo'), // novo → precisa evitar "bolo"
    ]
    const out = computeSlugBackfill(rows)
    expect(out).toEqual([{ id: 'b', locale: 'pt-BR', slug: 'bolo-1' }])
  })

  it('é IDEMPOTENTE: rodar de novo sobre o estado pós-backfill não atribui nada', () => {
    const initial = [row('a', 'pt-BR', 'Bolo'), row('b', 'pt-BR', 'Bolo')]
    const first = computeSlugBackfill(initial)
    // Aplica o resultado (simula o UPDATE) e re-roda.
    const applied = initial.map((r) => {
      const a = first.find((x) => x.id === r.id)
      return a ? { ...r, slug: a.slug } : r
    })
    const second = computeSlugBackfill(applied)
    expect(second).toEqual([])
  })

  it('é DETERMINÍSTICO: a mesma entrada ordenada produz exatamente as mesmas atribuições', () => {
    const rows = [
      row('a', 'pt-BR', 'Bolo'),
      row('b', 'en-US', 'Cake'),
      row('c', 'pt-BR', 'Bolo'),
    ]
    expect(computeSlugBackfill(rows)).toEqual(computeSlugBackfill([...rows]))
  })

  it('títulos sem ascii caem no fallback e desambiguam entre si dentro do locale', () => {
    const rows = [row('a', 'pt-BR', '!!!'), row('b', 'pt-BR', '寿司')]
    const out = computeSlugBackfill(rows)
    expect(out.map((x) => x.slug)).toEqual(['receita', 'receita-1'])
  })
})
