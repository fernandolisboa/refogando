import { describe, expect, it } from 'vitest'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import {
  RECIPE_GEN_KINDS,
  RecipeGenSchema,
  buildRecipeGenSchema,
  buildRecipeGenListSchema,
} from '@/domain/recipe-gen-schema'
import type { CampoDescartado, ReceitaGenT } from '@/domain/recipe-gen-schema'

// Receita "miolo" completa e válida — base reutilizável nos casos abaixo.
function receitaCompleta(): ReceitaGenT {
  return {
    titulo: 'Risoto de cogumelos',
    descricao: 'Cremoso e reconfortante.',
    passos: ['Refogue a cebola', 'Adicione o arroz', 'Vá pingando o caldo'],
    notas: 'Use caldo quente.',
    originalLocale: 'pt-BR',
    cozinha: 'italiana',
    categoria: 'prato_principal',
    restricoes: ['vegetariano'],
    porcoes: 4,
    dificuldade: 3,
    ingredientes: [
      { nome: 'arroz arbóreo', quantidade: '1', unidade: 'xicara' },
      { nome: 'cogumelos', quantidade: null, unidade: 'a_gosto' },
    ],
  }
}

describe('RecipeGenSchema — forma FLAT-OBJECT (§2 fallback)', () => {
  it('aceita um objeto kind:success completo, com receita inteira', () => {
    const parsed = RecipeGenSchema.parse({
      kind: 'success',
      receita: receitaCompleta(),
      advisory: null,
    })
    expect(parsed.kind).toBe('success')
    expect(parsed.receita?.titulo).toBe('Risoto de cogumelos')
    // quantidade trafega como string|null (numeric(10,3) vira string), não number.
    expect(parsed.receita?.ingredientes[0].quantidade).toBe('1')
    expect(parsed.receita?.ingredientes[1].quantidade).toBeNull()
  })

  it('aceita cada um dos 4 kinds com receita PRESENTE', () => {
    for (const kind of RECIPE_GEN_KINDS) {
      const parsed = RecipeGenSchema.parse({
        kind,
        receita: receitaCompleta(),
        advisory: null,
      })
      expect(parsed.kind).toBe(kind)
      expect(parsed.receita).not.toBeNull()
    }
  })

  it('aceita cada um dos 4 kinds com receita NULL (cross-field é regra do app/classify, não do schema)', () => {
    for (const kind of RECIPE_GEN_KINDS) {
      const parsed = RecipeGenSchema.parse({
        kind,
        receita: null,
        advisory: 'algum comentário',
      })
      expect(parsed.kind).toBe(kind)
      expect(parsed.receita).toBeNull()
    }
  })

  it('aceita impossible com receita null (regra de app: impossible ⇒ receita null)', () => {
    const parsed = RecipeGenSchema.parse({
      kind: 'impossible',
      receita: null,
      advisory: 'Não dá pra fazer pizza só com água.',
    })
    expect(parsed.kind).toBe('impossible')
    expect(parsed.receita).toBeNull()
    expect(parsed.advisory).toBe('Não dá pra fazer pizza só com água.')
  })

  it('aceita success com receita null — o schema FLAT não enforça o cross-field (classify enforça)', () => {
    const parsed = RecipeGenSchema.parse({
      kind: 'success',
      receita: null,
      advisory: null,
    })
    expect(parsed.kind).toBe('success')
    expect(parsed.receita).toBeNull()
  })

  it('aceita restricoes vazio e descricao/notas null', () => {
    const receita = receitaCompleta()
    receita.restricoes = []
    receita.descricao = null
    receita.notas = null
    const parsed = RecipeGenSchema.parse({ kind: 'success', receita, advisory: null })
    expect(parsed.receita?.restricoes).toEqual([])
    expect(parsed.receita?.descricao).toBeNull()
    expect(parsed.receita?.notas).toBeNull()
  })

  it('schema ESTÁTICO permissivo (cozinha=string): aceita qualquer string e null (#318)', () => {
    // RecipeGenSchema = buildRecipeGenSchema([]) ⇒ cozinha cai em z.string().nullable(): o schema
    // estático NÃO constrange a cozinha (a virada #318 tornou recipe.cozinha um `text`). Qualquer
    // string E null passam — a constrição vive na chamada CONSTRITA (buildRecipeGenSchema(ativos)).
    for (const cozinha of ['italiana', 'americana', 'qualquer', null]) {
      const receita = { ...receitaCompleta(), cozinha }
      expect(RecipeGenSchema.parse({ kind: 'success', receita, advisory: null }).receita?.cozinha).toBe(
        cozinha,
      )
    }
  })
})

describe('buildRecipeGenSchema — cozinha constrita ao conjunto ATIVO (#318)', () => {
  it('lista não-vazia: ACEITA slugs do conjunto; fora dele vira null (a FK rejeitaria), sem lançar', () => {
    const schema = buildRecipeGenSchema(['italiana', 'americana'])
    // dentro do conjunto → aceito (inclusive 'americana', nova/data-driven).
    for (const cozinha of ['italiana', 'americana']) {
      const receita = { ...receitaCompleta(), cozinha }
      expect(schema.parse({ kind: 'success', receita, advisory: null }).receita?.cozinha).toBe(cozinha)
    }
    // fora do conjunto → null (o enum constringe ao vocabulário VIVO, mas não derruba a geração).
    const marciana = { ...receitaCompleta(), cozinha: 'marciana' }
    expect(schema.parse({ kind: 'success', receita: marciana, advisory: null }).receita?.cozinha).toBeNull()
  })

  it('lista VAZIA: cai em z.string() — NUNCA estoura na construção; aceita qualquer string e null', () => {
    // z.enum exige >=1 elemento (estouraria com tupla vazia) ⇒ o ramo vazio usa z.string().
    const schema = buildRecipeGenSchema([])
    for (const cozinha of ['qualquer', 'italiana', null]) {
      const receita = { ...receitaCompleta(), cozinha }
      expect(schema.parse({ kind: 'success', receita, advisory: null }).receita?.cozinha).toBe(cozinha)
    }
  })

  it('kind fora do enum é inferido (sem receita ⇒ impossible; com receita ⇒ success), sem lançar', () => {
    expect(RecipeGenSchema.parse({ kind: 'invalid', receita: null, advisory: 'x' }).kind).toBe('impossible')
    expect(RecipeGenSchema.parse({ kind: 'ok', receita: receitaCompleta(), advisory: null }).kind).toBe(
      'success',
    )
    // caixa/espaço é só normalizado
    expect(RecipeGenSchema.parse({ kind: ' Degraded ', receita: receitaCompleta(), advisory: null }).kind).toBe(
      'degraded',
    )
  })

  it('rejeita quantidade numérica (deve ser string|null)', () => {
    const receita = receitaCompleta()
    receita.ingredientes[0] = {
      nome: 'farinha',
      // número cru viola o contrato string|null
      quantidade: 2 as unknown as string,
      unidade: 'xicara',
    }
    expect(() => RecipeGenSchema.parse({ kind: 'success', receita, advisory: null })).toThrow()
  })

  it('quantidade fora do formato é normalizada ("2,5" → "2.5"; "" → null), sem lançar', () => {
    const casos: Array<[string, string | null]> = [
      ['2,5', '2.5'],
      ['1/2', '0.5'],
      ['', null],
      ['um punhado', null],
    ]
    for (const [q, esperado] of casos) {
      const receita = receitaCompleta()
      receita.ingredientes[0] = { nome: 'algo', quantidade: q, unidade: 'xicara' }
      const parsed = RecipeGenSchema.parse({ kind: 'success', receita, advisory: null })
      expect(parsed.receita?.ingredientes[0]).toMatchObject({ quantidade: esperado, unidade: 'xicara' })
    }
  })

  it('quantidade "a gosto" sem unidade vira unidade a_gosto (quantidade null)', () => {
    const receita = receitaCompleta()
    receita.ingredientes[0] = { nome: 'sal', quantidade: 'a gosto', unidade: null }
    const parsed = RecipeGenSchema.parse({ kind: 'success', receita, advisory: null })
    expect(parsed.receita?.ingredientes[0]).toEqual({ nome: 'sal', quantidade: null, unidade: 'a_gosto' })
  })

  it('aceita quantidade numérica válida ("2.500") e null', () => {
    const receita = receitaCompleta()
    receita.ingredientes = [
      { nome: 'farinha', quantidade: '2.500', unidade: 'xicara' },
      { nome: 'sal', quantidade: null, unidade: 'a_gosto' },
    ]
    const parsed = RecipeGenSchema.parse({ kind: 'success', receita, advisory: null })
    expect(parsed.receita?.ingredientes[0].quantidade).toBe('2.500')
    expect(parsed.receita?.ingredientes[1].quantidade).toBeNull()
  })
})

describe('buildRecipeGenListSchema — "gerar 2, o usuário escolhe" (#423)', () => {
  function item(over: Record<string, unknown> = {}) {
    return { kind: 'success', receita: receitaCompleta(), advisory: null, variacao: 'tradicional', ...over }
  }

  it('CRÍTICO: o zodOutputFormat NÃO emite $defs/$ref (o endpoint os REJEITA com 400)', () => {
    // O spike do #8 provou que $defs/$ref (da discriminated-union) quebram o structured output. O array
    // PLANO (sem .min/.max/.length) evita a hoistagem do item p/ $defs. Este teste É o guard de regressão:
    // se alguém adicionar um bound ao array, o zod hoista o item e este teste falha ANTES do 400 em prod.
    for (const slugs of [[], ['italiana', 'japonesa']]) {
      const fmt = zodOutputFormat(buildRecipeGenListSchema(slugs))
      const json = JSON.stringify(fmt.schema)
      expect(json).not.toContain('$defs')
      expect(json).not.toContain('$ref')
    }
  })

  it('aceita um lote de 2 variações válidas (flat object + variacao)', () => {
    const parsed = buildRecipeGenListSchema([]).parse({
      variacoes: [item({ variacao: 'tradicional' }), item({ variacao: 'criativa' })],
    })
    expect(parsed.variacoes).toHaveLength(2)
    expect(parsed.variacoes[0].variacao).toBe('tradicional')
    expect(parsed.variacoes[1].variacao).toBe('criativa')
    expect(parsed.variacoes[0].receita?.titulo).toBe('Risoto de cogumelos')
  })

  it('cada item carrega kind/receita/advisory/variacao (mesma forma do single + o rótulo do pólo)', () => {
    const parsed = buildRecipeGenListSchema([]).parse({
      variacoes: [
        item({ kind: 'impossible', receita: null, advisory: 'nope' }),
        item({ kind: 'degraded', advisory: 'troquei X' }),
      ],
    })
    expect(parsed.variacoes[0]).toMatchObject({ kind: 'impossible', receita: null, advisory: 'nope' })
    expect(parsed.variacoes[1]).toMatchObject({ kind: 'degraded', advisory: 'troquei X' })
  })

  it('cozinha constrita ao conjunto ATIVO por item (mesma regra #318 do single)', () => {
    const schema = buildRecipeGenListSchema(['italiana'])
    // dentro do conjunto → aceito.
    expect(() =>
      schema.parse({ variacoes: [item(), item({ receita: { ...receitaCompleta(), cozinha: 'italiana' } })] }),
    ).not.toThrow()
    // fora do conjunto → null, sem derrubar o lote.
    const parsed = schema.parse({
      variacoes: [item(), item({ receita: { ...receitaCompleta(), cozinha: 'marciana' } })],
    })
    expect(parsed.variacoes[1].receita?.cozinha).toBeNull()
  })

  it('rejeita item sem `variacao` (rótulo do pólo é obrigatório)', () => {
    const semVariacao = { kind: 'success', receita: receitaCompleta(), advisory: null }
    expect(() => buildRecipeGenListSchema([]).parse({ variacoes: [semVariacao, item()] })).toThrow()
  })
})

describe('originalLocale — string livre (quem normaliza é o classify)', () => {
  it("o parse do SDK ACEITA 'en' (um enum aqui lançaria → parse_failed → 502)", () => {
    const fmt = zodOutputFormat(buildRecipeGenSchema(['italiana']))
    const receita = { ...receitaCompleta(), originalLocale: 'en' }
    const parsed = fmt.parse(JSON.stringify({ kind: 'success', receita, advisory: null }))
    expect(parsed.receita?.originalLocale).toBe('en')
  })

  it('o JSON Schema enviado à Anthropic orienta os locales na description', () => {
    const json = JSON.stringify(zodOutputFormat(buildRecipeGenSchema(['italiana'])).schema)
    expect(json).toContain("'pt-BR' ou 'en-US'")
    expect(json).toContain('não o do texto de origem')
  })
})

describe('tolerância no parse do SDK — formato fora do enum NUNCA derruba a geração', () => {
  // Pelo `fmt.parse` do zodOutputFormat: é o caminho que lançava (→ parse_failed → 502) em produção.
  function parseSdk(receita: Record<string, unknown>, slugs: string[] = ['italiana', 'arabe']) {
    const descartes: CampoDescartado[] = []
    const fmt = zodOutputFormat(buildRecipeGenSchema(slugs, (d) => descartes.push(d)))
    const parsed = fmt.parse(JSON.stringify({ kind: 'success', receita, advisory: null }))
    return { receita: parsed.receita, descartes }
  }

  it('normaliza caixa, acento, rótulo e sinônimo PT/EN nos campos de vocabulário', () => {
    const { receita, descartes } = parseSdk({
      ...receitaCompleta(),
      cozinha: 'Italiana',
      categoria: 'Prato Principal',
      restricoes: ['Vegetariano', 'gluten-free', 'vegan'],
      ingredientes: [
        { nome: 'farinha', quantidade: '1 1/2', unidade: 'Xícaras' },
        { nome: 'azeite', quantidade: '2', unidade: 'tbsp' },
        { nome: 'alho', quantidade: '½', unidade: 'dentes' },
      ],
    })
    expect(receita).toMatchObject({
      cozinha: 'italiana',
      categoria: 'prato_principal',
      restricoes: ['vegetariano', 'sem_gluten', 'vegano'],
      ingredientes: [
        { nome: 'farinha', quantidade: '1.5', unidade: 'xicara' },
        { nome: 'azeite', quantidade: '2', unidade: 'colher_de_sopa' },
        { nome: 'alho', quantidade: '0.5', unidade: 'dente' },
      ],
    })
    expect(descartes).toEqual([])
  })

  it('cozinha pelo rótulo em inglês da seed ("Arabic" → arabe) quando está no conjunto ativo', () => {
    expect(parseSdk({ ...receitaCompleta(), cozinha: 'Arabic' }).receita?.cozinha).toBe('arabe')
    // 'Mexican' é da seed mas não está ATIVA neste conjunto → null
    expect(parseSdk({ ...receitaCompleta(), cozinha: 'Mexican' }).receita?.cozinha).toBeNull()
  })

  it('não reconhecido cai no fallback (null / descartado) e é reportado', () => {
    const { receita, descartes } = parseSdk({
      ...receitaCompleta(),
      cozinha: 'Marciana',
      categoria: 'Petisco de festa',
      restricoes: ['vegetariano', 'paleo'],
      ingredientes: [{ nome: 'salsinha', quantidade: 'um maço', unidade: 'maço' }],
    })
    expect(receita).toMatchObject({
      cozinha: null,
      categoria: null,
      restricoes: ['vegetariano'],
      ingredientes: [{ nome: 'salsinha', quantidade: null, unidade: null }],
    })
    expect(descartes).toEqual([
      { campo: 'cozinha', valor: 'Marciana' },
      { campo: 'categoria', valor: 'Petisco de festa' },
      { campo: 'restricoes', valor: 'paleo' },
      { campo: 'quantidade', valor: 'um maço' },
      { campo: 'unidade', valor: 'maço' },
    ])
  })

  it('o lote de variações tem a mesma tolerância', () => {
    const fmt = zodOutputFormat(buildRecipeGenListSchema(['italiana']))
    const receita = { ...receitaCompleta(), categoria: 'Sobremesa', cozinha: 'ITALIANA' }
    const parsed = fmt.parse(
      JSON.stringify({
        variacoes: [
          { kind: 'Success', receita, advisory: null, variacao: 'a' },
          { kind: 'success', receita: receitaCompleta(), advisory: null, variacao: 'b' },
        ],
      }),
    )
    expect(parsed.variacoes[0]).toMatchObject({ kind: 'success', receita: { categoria: 'sobremesa', cozinha: 'italiana' } })
  })

  it('o JSON Schema enviado segue com os enums/pattern como dica e sem $defs/$ref', () => {
    const json = JSON.stringify(zodOutputFormat(buildRecipeGenSchema(['italiana', 'arabe'])).schema)
    expect(json).not.toContain('$defs')
    expect(json).not.toContain('$ref')
    for (const dica of ['prato_principal', 'colher_de_sopa', 'sem_gluten', 'arabe', 'impossible', 'pattern']) {
      expect(json).toContain(dica)
    }
  })
})
