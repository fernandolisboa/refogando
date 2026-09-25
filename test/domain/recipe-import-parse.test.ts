import { describe, it, expect } from 'vitest'
import { parseImportedRecipe } from '@/domain/recipe-import-parse'

/**
 * Parser PURO de schema.org/Recipe (JSON-LD) — #165, ADR-0019. Sem rede, sem DB. Cobre: extração do
 * bloco ld+json (objeto direto, array, @graph), forma de instruções (string/array/HowToStep/
 * HowToSection), best-effort de quantidade/unidade, detecção de locale (inLanguage + <html lang>),
 * atribuição (publisher/author/host), e as falhas TRATADAS (no_jsonld / unsupported_locale).
 */

const SRC = 'https://exemplo.com/receitas/bolo'

function htmlWith(jsonLd: unknown, opts?: { lang?: string }): string {
  const langAttr = opts?.lang ? ` lang="${opts.lang}"` : ''
  return `<!doctype html><html${langAttr}><head><script type="application/ld+json">${JSON.stringify(
    jsonLd,
  )}</script></head><body>conteúdo</body></html>`
}

describe('parseImportedRecipe (#165)', () => {
  it('extrai a Receita de um JSON-LD objeto direto (pt-BR via inLanguage)', () => {
    const r = parseImportedRecipe(
      htmlWith({
        '@context': 'https://schema.org',
        '@type': 'Recipe',
        name: 'Bolo de Cenoura',
        description: 'Bolo fofinho',
        inLanguage: 'pt-BR',
        recipeIngredient: ['2 xícaras de farinha', '3 ovos', 'sal a gosto'],
        recipeInstructions: ['Misture tudo', 'Asse por 40 minutos'],
        publisher: { '@type': 'Organization', name: 'Cozinha da Vovó' },
      }),
      SRC,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.recipe.titulo).toBe('Bolo de Cenoura')
    // #272/ADR-0019: o `description`/headnote da fonte (aqui "Bolo fofinho") é camada PROTEGIDA — o
    // parser NÃO o copia (a importada nasce com headnote em branco). Os FATOS seguem extraídos.
    expect('descricao' in r.recipe).toBe(false)
    expect(r.recipe.originalLocale).toBe('pt-BR')
    expect(r.recipe.passos).toEqual(['Misture tudo', 'Asse por 40 minutos'])
    expect(r.recipe.sourceName).toBe('Cozinha da Vovó')
    // best-effort: a medida vai para qty/unidade e é TIRADA do nome (rawText = nome SEM medida,
    // ADR-0012 Adendo). "2 xícaras de farinha" → 2 / xicara / "farinha"; "3 ovos" → 3 / null /
    // "ovos"; "sal a gosto" (sem número líder) → null/null e o nome fica cru ("sal a gosto").
    expect(r.recipe.ingredientes).toEqual([
      { rawText: 'farinha', quantidade: '2', unidade: 'xicara' },
      { rawText: 'ovos', quantidade: '3', unidade: null },
      { rawText: 'sal a gosto', quantidade: null, unidade: null },
    ])
  })

  it('acha a Receita dentro de um @graph e @type como array', () => {
    const r = parseImportedRecipe(
      htmlWith({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebSite', name: 'Site' },
          {
            '@type': ['Recipe', 'Thing'],
            name: 'Pão Caseiro',
            inLanguage: 'pt',
            recipeInstructions: 'Sove e asse.',
          },
        ],
      }),
      SRC,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.recipe.titulo).toBe('Pão Caseiro')
    expect(r.recipe.originalLocale).toBe('pt-BR') // 'pt' → pt-BR (base match)
    expect(r.recipe.passos).toEqual(['Sove e asse.']) // string única vira UM passo
  })

  it('achata HowToStep e HowToSection em string[]', () => {
    const r = parseImportedRecipe(
      htmlWith({
        '@type': 'Recipe',
        name: 'Lasanha',
        inLanguage: 'en-US',
        recipeInstructions: [
          { '@type': 'HowToStep', text: 'Boil pasta' },
          {
            '@type': 'HowToSection',
            itemListElement: [
              { '@type': 'HowToStep', text: 'Layer sauce' },
              { '@type': 'HowToStep', text: 'Bake' },
            ],
          },
        ],
      }),
      SRC,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.recipe.passos).toEqual(['Boil pasta', 'Layer sauce', 'Bake'])
    expect(r.recipe.originalLocale).toBe('en-US')
  })

  it('detecta locale pelo <html lang> quando inLanguage falta', () => {
    const r = parseImportedRecipe(
      htmlWith({ '@type': 'Recipe', name: 'Chili', recipeInstructions: 'Cook.' }, { lang: 'en-US' }),
      SRC,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.recipe.originalLocale).toBe('en-US')
  })

  it('best-effort de unidade casa aliases PT/EN (tablespoon, g, dente)', () => {
    const r = parseImportedRecipe(
      htmlWith({
        '@type': 'Recipe',
        name: 'Tempero',
        inLanguage: 'en-US',
        recipeIngredient: ['2 tablespoons olive oil', '500 g flour', '3 cloves garlic', 'a handful of salt'],
      }),
      SRC,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // medida TIRADA do nome; o conector líder ("of") some, o nome preserva o casing original.
    expect(r.recipe.ingredientes).toEqual([
      { rawText: 'olive oil', quantidade: '2', unidade: 'colher_de_sopa' },
      { rawText: 'flour', quantidade: '500', unidade: 'g' },
      { rawText: 'garlic', quantidade: '3', unidade: 'dente' },
      { rawText: 'a handful of salt', quantidade: null, unidade: null },
    ])
  })

  it('aliases compartilhados com a geração: "gr", "Xícaras", "colheres (sopa)"; "constructor" não é unidade', () => {
    const r = parseImportedRecipe(
      htmlWith({
        '@type': 'Recipe',
        name: 'Bolo',
        inLanguage: 'pt-BR',
        recipeIngredient: ['200 gr de farinha', '2 Xícaras de leite', '1 colheres (sopa) de fermento', '2 constructor ovos'],
      }),
      SRC,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.recipe.ingredientes).toEqual([
      { rawText: 'farinha', quantidade: '200', unidade: 'g' },
      { rawText: 'leite', quantidade: '2', unidade: 'xicara' },
      { rawText: 'fermento', quantidade: '1', unidade: 'colher_de_sopa' },
      { rawText: 'constructor ovos', quantidade: '2', unidade: null },
    ])
  })

  it('TIRA a medida do nome: número + unidade + conector ("320 g de arroz arbóreo" → "arroz arbóreo")', () => {
    const r = parseImportedRecipe(
      htmlWith({
        '@type': 'Recipe',
        name: 'Risoto',
        inLanguage: 'pt-BR',
        recipeIngredient: [
          '320 g de arroz arbóreo',
          '2 colheres de sopa de azeite',
          '½ xícara de vinho branco',
          '4 ovos',
        ],
      }),
      SRC,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.recipe.ingredientes).toEqual([
      { rawText: 'arroz arbóreo', quantidade: '320', unidade: 'g' },
      { rawText: 'azeite', quantidade: '2', unidade: 'colher_de_sopa' },
      { rawText: 'vinho branco', quantidade: '0.5', unidade: 'xicara' },
      { rawText: 'ovos', quantidade: '4', unidade: null },
    ])
  })

  it('atribui pelo host da URL quando não há publisher/author', () => {
    const r = parseImportedRecipe(
      htmlWith({ '@type': 'Recipe', name: 'Sopa', inLanguage: 'pt-BR' }),
      'https://www.meusite.com/sopa',
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.recipe.sourceName).toBe('www.meusite.com')
  })

  it('sem JSON-LD de Recipe → no_jsonld (não importa)', () => {
    const r = parseImportedRecipe(
      htmlWith({ '@type': 'Article', headline: 'Não é receita' }),
      SRC,
    )
    expect(r).toEqual({ ok: false, reason: 'no_jsonld' })
  })

  it('HTML sem nenhum bloco ld+json → no_jsonld', () => {
    const r = parseImportedRecipe('<html><body>nada aqui</body></html>', SRC)
    expect(r).toEqual({ ok: false, reason: 'no_jsonld' })
  })

  it('Recipe sem name legível → no_jsonld (título é o campo mínimo)', () => {
    const r = parseImportedRecipe(
      htmlWith({ '@type': 'Recipe', inLanguage: 'pt-BR', recipeInstructions: 'x' }),
      SRC,
    )
    expect(r).toEqual({ ok: false, reason: 'no_jsonld' })
  })

  it('idioma fora de PT/EN (fr-FR) → unsupported_locale (não importa)', () => {
    const r = parseImportedRecipe(
      htmlWith({ '@type': 'Recipe', name: 'Ratatouille', inLanguage: 'fr-FR' }),
      SRC,
    )
    expect(r).toEqual({ ok: false, reason: 'unsupported_locale' })
  })

  it('sem nenhum sinal de idioma → unsupported_locale (não chuta)', () => {
    const r = parseImportedRecipe(htmlWith({ '@type': 'Recipe', name: 'X' }), SRC)
    expect(r).toEqual({ ok: false, reason: 'unsupported_locale' })
  })

  it('ignora blocos ld+json malformados e usa o próximo válido', () => {
    const html =
      '<html><head>' +
      '<script type="application/ld+json">{ isto não é json }</script>' +
      `<script type="application/ld+json">${JSON.stringify({
        '@type': 'Recipe',
        name: 'Resiliente',
        inLanguage: 'pt-BR',
      })}</script>` +
      '</head></html>'
    const r = parseImportedRecipe(html, SRC)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.recipe.titulo).toBe('Resiliente')
  })
})
