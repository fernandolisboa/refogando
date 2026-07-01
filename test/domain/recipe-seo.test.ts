import { describe, it, expect } from 'vitest'
import {
  buildRecipeMetadata,
  buildRecipeJsonLd,
  serializeJsonLd,
  minutosParaISO8601,
  type RecipeSeoInput,
} from '@/domain/recipe-seo'

/**
 * Builders PUROS de SEO do detalhe da Receita (#232 OG, #233 canonical/hreflang/robots, #234
 * JSON-LD) — sem DB, sem React, sem `next/*`. Recebem os dados JÁ carregados/resolvidos (nome,
 * corpo, slugs por locale, imagem, proveniência) e a `baseUrl` build-safe (env, sem `headers()`),
 * e devolvem o objeto `Metadata` do Next (#232/#233) e o objeto JSON-LD `schema.org/Recipe` (#234).
 * O `generateMetadata` e a página viram cascas finas que carregam o I/O e chamam estes builders.
 *
 * Decisões travadas exercitadas aqui:
 *  - OG sem selo de IA mesmo com imagem `ai_generated` (no card a imagem é vitrine — #232).
 *  - canonical = slug do locale CORRENTE; hreflang SÓ pros locales que TÊM tradução pública com
 *    slug + x-default → DEFAULT_LOCALE (#233). NÃO inventa URL de locale inexistente.
 *  - robots index/follow pra elegível; noindex pra não-elegível (#233).
 *  - JSON-LD emite `aggregateRating` (#367) SÓ com ≥1 avaliação não-moderada E receita indexável
 *    (média CRUA arredondada a 1 casa, nunca Bayesiano); ingredientes/passos/imagem/inLanguage (#234).
 */

const BASE = 'https://refogando.com'

// Fixture-base de uma Receita pública pt-BR com tradução en-US (ambos com slug).
function baseInput(over: Partial<RecipeSeoInput> = {}): RecipeSeoInput {
  return {
    locale: 'pt-BR',
    baseUrl: BASE,
    name: 'Bolo de Cenoura',
    description: 'Um bolo fofinho de cenoura com cobertura de chocolate.',
    ingredients: ['2 cenouras médias', '3 ovos', '2 xícaras de farinha'],
    steps: ['Bata os líquidos.', 'Misture os secos.', 'Asse por 40 minutos.'],
    slugsByLocale: { 'pt-BR': 'bolo-de-cenoura', 'en-US': 'carrot-cake' },
    brandName: 'Refogando',
    ...over,
  }
}

describe('buildRecipeMetadata — OG (#232)', () => {
  it('emite og:title/description/url/type + twitter summary_large_image', () => {
    const meta = buildRecipeMetadata(baseInput())
    expect(meta.openGraph?.title).toBe('Bolo de Cenoura')
    expect(meta.openGraph?.description).toBe(
      'Um bolo fofinho de cenoura com cobertura de chocolate.',
    )
    // `type`/`card` vivem em membros específicos da união OpenGraph/Twitter — narrow por `in`.
    const og = meta.openGraph
    expect(og && 'type' in og ? og.type : undefined).toBe('article')
    expect(meta.openGraph?.url).toBe(`${BASE}/pt-BR/recipes/bolo-de-cenoura`)
    const tw = meta.twitter
    expect(tw && 'card' in tw ? tw.card : undefined).toBe('summary_large_image')
  })

  it('usa a FOTO da receita como og:image quando há imageUrl (URL absoluta)', () => {
    const url = 'https://abc.public.blob.vercel-storage.com/recipes/x.webp'
    const meta = buildRecipeMetadata(baseInput({ imageUrl: url }))
    const images = meta.openGraph?.images
    const first = Array.isArray(images) ? images[0] : images
    const got = typeof first === 'object' && first != null && 'url' in first ? first.url : first
    expect(got).toBe(url)
  })

  it('cai no card de MARCA (asset default estável) quando NÃO há imagem', () => {
    const meta = buildRecipeMetadata(baseInput({ imageUrl: undefined }))
    const images = meta.openGraph?.images
    const first = Array.isArray(images) ? images[0] : images
    const got = typeof first === 'object' && first != null && 'url' in first ? first.url : first
    // Asset absoluto sob a baseUrl (não um path relativo nu).
    expect(String(got)).toBe(`${BASE}/opengraph-image.png`)
  })

  it('selo de IA NÃO altera o OG/twitter — `imageAiGenerated` true vs false são BYTE-idênticos', () => {
    // Invariante ESTRUTURAL (à prova de fraseado futuro): a ÚNICA diferença entre uma receita com
    // imagem ai_generated e sem o selo é o flag — e ele NÃO pode vazar p/ nenhum byte do card. Mais
    // forte que um denylist de frases (que envelhece): se algum dia o builder compuser um selo no OG,
    // os blobs divergem e este teste pega.
    const url = 'https://abc.public.blob.vercel-storage.com/recipes/ai.webp'
    const withFlag = buildRecipeMetadata(baseInput({ imageUrl: url, imageAiGenerated: true }))
    const withoutFlag = buildRecipeMetadata(baseInput({ imageUrl: url, imageAiGenerated: false }))
    expect(JSON.stringify(withFlag.openGraph)).toBe(JSON.stringify(withoutFlag.openGraph))
    expect(JSON.stringify(withFlag.twitter)).toBe(JSON.stringify(withoutFlag.twitter))
  })

  it('metadataBase é a baseUrl build-safe (env), nunca derivada de headers()', () => {
    const meta = buildRecipeMetadata(baseInput())
    expect(meta.metadataBase?.toString()).toBe(`${BASE}/`)
  })

  it('descrição só-whitespace ⇒ openGraph.description E ld.description AMBOS undefined (não " ")', () => {
    // Fallback de descrição vazia/whitespace: nem o OG nem o JSON-LD podem carregar uma descrição
    // em branco (poluiria o card/markup). O builder trima e cai em undefined (chave omitida).
    const input = baseInput({ description: '   ' })
    const meta = buildRecipeMetadata(input)
    expect(meta.openGraph?.description).toBeUndefined()
    expect(meta.description).toBeUndefined()
    const ld = buildRecipeJsonLd(input)
    expect(ld.description).toBeUndefined()
  })
})

describe('buildRecipeMetadata — canonical + hreflang + x-default + robots (#233)', () => {
  it('canonical aponta pro slug do locale CORRENTE', () => {
    const meta = buildRecipeMetadata(baseInput({ locale: 'pt-BR' }))
    expect(meta.alternates?.canonical).toBe(`${BASE}/pt-BR/recipes/bolo-de-cenoura`)
    const metaEn = buildRecipeMetadata(baseInput({ locale: 'en-US' }))
    expect(metaEn.alternates?.canonical).toBe(`${BASE}/en-US/recipes/carrot-cake`)
  })

  it('hreflang inclui APENAS os locales com slug público + x-default → DEFAULT_LOCALE', () => {
    const meta = buildRecipeMetadata(baseInput())
    const langs = meta.alternates?.languages ?? {}
    expect(langs['pt-BR']).toBe(`${BASE}/pt-BR/recipes/bolo-de-cenoura`)
    expect(langs['en-US']).toBe(`${BASE}/en-US/recipes/carrot-cake`)
    // x-default aponta pro DEFAULT_LOCALE (pt-BR).
    expect(langs['x-default']).toBe(`${BASE}/pt-BR/recipes/bolo-de-cenoura`)
  })

  it('NÃO inventa hreflang de locale sem tradução pública (acervo só pt-BR hoje)', () => {
    const meta = buildRecipeMetadata(
      baseInput({ slugsByLocale: { 'pt-BR': 'so-portugues' } }),
    )
    const langs = meta.alternates?.languages ?? {}
    expect(langs['pt-BR']).toBe(`${BASE}/pt-BR/recipes/so-portugues`)
    expect(langs['en-US']).toBeUndefined()
    // x-default cai no DEFAULT_LOCALE existente.
    expect(langs['x-default']).toBe(`${BASE}/pt-BR/recipes/so-portugues`)
  })

  it('robots = index/follow pra Receita pública elegível (eligible !== false)', () => {
    const meta = buildRecipeMetadata(baseInput({ eligible: true }))
    const robots = meta.robots
    const r = typeof robots === 'object' && robots != null ? robots : {}
    expect(r.index).toBe(true)
    expect(r.follow).toBe(true)
  })

  it('robots = noindex quando NÃO elegível (caminho do dono/privado/não-público)', () => {
    const meta = buildRecipeMetadata(baseInput({ eligible: false }))
    const robots = meta.robots
    const r = typeof robots === 'object' && robots != null ? robots : {}
    expect(r.index).toBe(false)
  })
})

describe('buildRecipeJsonLd — schema.org/Recipe (#234)', () => {
  it('emite Recipe com name/description/ingredientes/passos(HowToStep)/inLanguage', () => {
    const ld = buildRecipeJsonLd(baseInput())
    expect(ld['@context']).toBe('https://schema.org')
    expect(ld['@type']).toBe('Recipe')
    expect(ld.name).toBe('Bolo de Cenoura')
    expect(ld.description).toBe('Um bolo fofinho de cenoura com cobertura de chocolate.')
    expect(ld.inLanguage).toBe('pt-BR')
    expect(ld.recipeIngredient).toEqual([
      '2 cenouras médias',
      '3 ovos',
      '2 xícaras de farinha',
    ])
    expect(ld.recipeInstructions).toEqual([
      { '@type': 'HowToStep', text: 'Bata os líquidos.' },
      { '@type': 'HowToStep', text: 'Misture os secos.' },
      { '@type': 'HowToStep', text: 'Asse por 40 minutos.' },
    ])
  })

  it('image = a foto VISÍVEL da receita (URL absoluta) quando há', () => {
    const url = 'https://abc.public.blob.vercel-storage.com/recipes/x.webp'
    const ld = buildRecipeJsonLd(baseInput({ imageUrl: url }))
    expect(ld.image).toBe(url)
  })

  it('author quando há dono humano (sem fonte)', () => {
    const ld = buildRecipeJsonLd(baseInput({ author: { name: 'Maria', handle: 'maria' } }))
    expect(ld.author).toEqual({ '@type': 'Person', name: 'Maria' })
  })

  it('isBasedOn/fonte quando web_imported (creditа a fonte externa, não o importador)', () => {
    const ld = buildRecipeJsonLd(
      baseInput({
        author: undefined,
        source: { url: 'https://exemplo.com/receita', name: 'Site Exemplo' },
      }),
    )
    // Atribuição à FONTE externa: nunca um author humano inventado.
    expect(ld.author).toBeUndefined()
    expect(ld.isBasedOn).toBe('https://exemplo.com/receita')
  })

  it('inLanguage acompanha o locale corrente', () => {
    const ld = buildRecipeJsonLd(baseInput({ locale: 'en-US' }))
    expect(ld.inLanguage).toBe('en-US')
  })

  it('mapeia recipeYield←porções, recipeCuisine←cozinha, recipeCategory←categoria, datePublished (ADR-0020 dec.7)', () => {
    const ld = buildRecipeJsonLd(
      baseInput({
        porcoes: 4,
        cozinha: 'brasileira',
        categoria: 'sobremesa',
        datePublished: '2026-06-23T10:00:00.000Z',
      }),
    )
    expect(ld.recipeYield).toBe('4') // schema.org aceita texto; numérico vira string
    expect(ld.recipeCuisine).toBe('brasileira')
    expect(ld.recipeCategory).toBe('sobremesa')
    expect(ld.datePublished).toBe('2026-06-23T10:00:00.000Z')
  })

  it('OMITE recipeYield/recipeCuisine/recipeCategory/datePublished quando ausentes (chave vazia não sai)', () => {
    const ld = buildRecipeJsonLd(
      baseInput({ porcoes: null, cozinha: null, categoria: null, datePublished: null }),
    )
    expect('recipeYield' in ld).toBe(false)
    expect('recipeCuisine' in ld).toBe(false)
    expect('recipeCategory' in ld).toBe(false)
    expect('datePublished' in ld).toBe(false)
  })

  it('suitableForDiet mapeia SÓ as restrições com RestrictedDiet válido (lossy é OMITIDA)', () => {
    // sem_gluten/vegano mapeiam; sem_acucar/low_carb NÃO têm equivalente schema.org ⇒ OMITIDAS
    // (nunca enum inválido — risco de ação manual do Google).
    const ld = buildRecipeJsonLd(
      baseInput({ restricoes: ['sem_gluten', 'vegano', 'sem_acucar', 'low_carb'] }),
    )
    expect(ld.suitableForDiet).toEqual([
      'https://schema.org/GlutenFreeDiet',
      'https://schema.org/VeganDiet',
    ])
  })

  it('suitableForDiet AUSENTE quando NENHUMA restrição mapeia (só lossy) — não emite array vazio', () => {
    const ld = buildRecipeJsonLd(baseInput({ restricoes: ['sem_acucar', 'low_carb'] }))
    expect('suitableForDiet' in ld).toBe(false)
  })

  it('suitableForDiet AUSENTE quando não há restrição', () => {
    const ld = buildRecipeJsonLd(baseInput({ restricoes: [] }))
    expect('suitableForDiet' in ld).toBe(false)
  })
})

describe('buildRecipeJsonLd — aggregateRating (#367, ADR-0027 dec.6)', () => {
  it('emite aggregateRating com média CRUA + contagem REAL quando count ≥ 1 e elegível (default)', () => {
    // Média genuína de Avaliação (#363/ADR-0027 dec.6) vira `AggregateRating`. `ratingCount` E
    // `reviewCount` = a contagem REAL (dois nomes do mesmo número no schema.org).
    const ld = buildRecipeJsonLd(baseInput({ rating: { value: 4.6, count: 23 } }))
    expect(ld.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.6,
      ratingCount: 23,
      reviewCount: 23,
    })
  })

  it('OMITE aggregateRating quando count === 0', () => {
    const ld = buildRecipeJsonLd(baseInput({ rating: { value: 0, count: 0 } }))
    expect('aggregateRating' in ld).toBe(false)
  })

  it('OMITE aggregateRating quando rating ausente OU null (sem avaliações)', () => {
    expect('aggregateRating' in buildRecipeJsonLd(baseInput())).toBe(false)
    expect('aggregateRating' in buildRecipeJsonLd(baseInput({ rating: null }))).toBe(false)
  })

  it('OMITE aggregateRating quando NÃO elegível (noindex/privado) mesmo com count ≥ 1', () => {
    // Mesmo gate do robots noindex (#233): uma receita fora do índice não emite structured data
    // de rating pro grafo. `eligible: false` cala o aggregateRating ainda que haja avaliações.
    const ld = buildRecipeJsonLd(baseInput({ eligible: false, rating: { value: 5, count: 10 } }))
    expect('aggregateRating' in ld).toBe(false)
  })

  it('emite p/ COMUNIDADE (com autor humano) E p/ CATÁLOGO (sem autor) — o builder é agnóstico', () => {
    const comunidade = buildRecipeJsonLd(
      baseInput({ author: { name: 'Maria', handle: 'maria' }, rating: { value: 4.2, count: 8 } }),
    )
    expect(comunidade.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.2,
      ratingCount: 8,
      reviewCount: 8,
    })
    const catalogo = buildRecipeJsonLd(
      baseInput({ author: undefined, rating: { value: 4.2, count: 8 } }),
    )
    expect(catalogo.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.2,
      ratingCount: 8,
      reviewCount: 8,
    })
  })

  it('NUNCA Bayesiano: o ratingValue emitido é EXATAMENTE a média crua passada (5★ em 1 avaliação)', () => {
    // O Bayesiano (#368) só ORDENA o ranking (suprime 5★/1 nota); o MARKUP carrega a média crua
    // genuína, INALTERADA — o builder não faz nenhuma transformação estatística.
    const ld = buildRecipeJsonLd(baseInput({ rating: { value: 5, count: 1 } }))
    expect(ld.aggregateRating?.ratingValue).toBe(5)
    expect(ld.aggregateRating?.ratingCount).toBe(1)
    expect(ld.aggregateRating?.reviewCount).toBe(1)
  })

  it('arredonda ratingValue a 1 casa decimal (casa com o display da página: 4,3333 → 4,3)', () => {
    // O Google exige que o número do markup esteja VISÍVEL na página; a seção de Avaliações mostra
    // a média com 1 casa (toLocaleString), então o markup usa a MESMA precisão.
    const ld = buildRecipeJsonLd(baseInput({ rating: { value: 4.3333, count: 9 } }))
    expect(ld.aggregateRating?.ratingValue).toBe(4.3)
    const ld2 = buildRecipeJsonLd(baseInput({ rating: { value: 4.35, count: 4 } }))
    expect(ld2.aggregateRating?.ratingValue).toBe(4.4)
  })
})

describe('serializeJsonLd — string segura pro <script> (XSS de </script>)', () => {
  const PAYLOAD = '</script><script>alert(1)</script>'

  // Parametriza o payload perigoso por MAIS DE UM campo: texto livre (name/description) E uma URL
  // (image via imageUrl, isBasedOn via source.url). Prova que o escape cobre TODO campo serializado,
  // não só o `name`. Cada caso constrói o input que faz aquele campo carregar o payload.
  const cases: Array<{ field: string; build: () => ReturnType<typeof buildRecipeJsonLd> }> = [
    { field: 'name', build: () => buildRecipeJsonLd(baseInput({ name: `Bolo ${PAYLOAD}` })) },
    {
      field: 'description',
      build: () => buildRecipeJsonLd(baseInput({ description: `Fofo ${PAYLOAD}` })),
    },
    {
      field: 'image',
      build: () => buildRecipeJsonLd(baseInput({ imageUrl: `https://x/${PAYLOAD}.webp` })),
    },
    {
      field: 'isBasedOn',
      build: () =>
        buildRecipeJsonLd(
          baseInput({ author: undefined, source: { url: `https://x/${PAYLOAD}` } }),
        ),
    },
  ]

  for (const { field, build } of cases) {
    it(`escapa o \`<\` do payload em \`${field}\` (mecanismo: < → \\u003c)`, () => {
      const s = serializeJsonLd(build())
      // 1) o </script> literal sumiu (não fecharia a tag no HTML);
      expect(s).not.toContain('</script>')
      // 2) o MECANISMO: o `<` virou a sequência escapada `<` (não foi removido/strippado).
      expect(s).toContain('\\u003c')
      // 3) continua JSON VÁLIDO e o parser do navegador relê `<` como `<` — dado preservado.
      expect(() => JSON.parse(s)).not.toThrow()
      const parsed = JSON.parse(s)
      const flat = JSON.stringify(parsed)
      expect(flat).toContain(PAYLOAD) // o dado original sobrevive ao round-trip
    })
  }

  it('serializa um objeto COM aggregateRating (#367) válido e ainda escapa o `<`', () => {
    const ld = buildRecipeJsonLd(
      baseInput({ name: `Bolo ${PAYLOAD}`, rating: { value: 4.6, count: 23 } }),
    )
    const s = serializeJsonLd(ld)
    expect(s).not.toContain('</script>')
    expect(s).toContain('\\u003c')
    expect(() => JSON.parse(s)).not.toThrow()
    const parsed = JSON.parse(s)
    expect(parsed.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.6,
      ratingCount: 23,
      reviewCount: 23,
    })
  })
})

describe('minutosParaISO8601 (#262, ADR-0023 dec.4)', () => {
  it('converte minutos → ISO 8601 duration, omitindo o componente zero', () => {
    expect(minutosParaISO8601(90)).toBe('PT1H30M')
    expect(minutosParaISO8601(60)).toBe('PT1H')
    expect(minutosParaISO8601(5)).toBe('PT5M')
    expect(minutosParaISO8601(1)).toBe('PT1M')
    expect(minutosParaISO8601(125)).toBe('PT2H5M')
  })

  it('ausente / não-positivo (null/undefined/0/negativo) → null (chave omitida)', () => {
    expect(minutosParaISO8601(null)).toBeNull()
    expect(minutosParaISO8601(undefined)).toBeNull()
    expect(minutosParaISO8601(0)).toBeNull()
    expect(minutosParaISO8601(-5)).toBeNull()
  })
})

describe('buildRecipeJsonLd — totalTime (#262, fecha #234)', () => {
  it('emite totalTime (ISO 8601) quando tempo_total presente', () => {
    const ld = buildRecipeJsonLd(baseInput({ tempoTotalMin: 90 }))
    expect(ld.totalTime).toBe('PT1H30M')
  })

  it('OMITE totalTime quando tempo_total ausente (chave não sai)', () => {
    const ld = buildRecipeJsonLd(baseInput({ tempoTotalMin: null }))
    expect('totalTime' in ld).toBe(false)
  })

  it('NUNCA emite prepTime nem cookTime (ADR-0023 dec.4 — só totalTime)', () => {
    const ld = buildRecipeJsonLd(baseInput({ tempoTotalMin: 90 }))
    expect('prepTime' in ld).toBe(false)
    expect('cookTime' in ld).toBe(false)
  })
})
