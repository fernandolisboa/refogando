import { describe, expect, it } from 'vitest'
import {
  resolveBody,
  resolveFacets,
  resolveName,
  resolveRecipeView,
  type IngredientItem,
  type RecipeRow,
  type ResolveInput,
  type TranslationRow,
} from '@/domain/recipe-read'
import { MESSAGES } from '@/i18n/messages'

// ── Fixtures puros ───────────────────────────────────────────────────────────

const ptOriginal: TranslationRow = {
  locale: 'pt-BR',
  titulo: 'Feijoada',
  descricao: 'Ensopado de feijão preto com carnes.',
  passos: ['Demolhe o feijão.', 'Cozinhe as carnes.'],
  notas: 'Sirva com arroz.',
  provenance: 'escrita_por_pessoa',
  stale: false,
}

const enReliableDiffering: TranslationRow = {
  locale: 'en-US',
  titulo: 'Black Bean Stew',
  descricao: null, // parcial → cai no original
  passos: null,
  notas: null,
  provenance: 'automatica_revisada', // confiável
  stale: false,
}

const ingredients: IngredientItem[] = [
  { ordem: 0, quantidade: '2.500', unidade: 'xicara', rawText: null, alergenos: null },
  { ordem: 1, quantidade: null, unidade: 'a_gosto', rawText: 'a gosto', alergenos: null },
]

function recipeRow(over: Partial<RecipeRow> = {}): RecipeRow {
  return {
    id: 'r-1',
    origin: 'catalog',
    visibility: 'private',
    resultKind: 'success',
    originalLocale: 'pt-BR',
    cozinha: 'brasileira',
    categoria: 'prato_principal',
    restricoes: ['sem_gluten'],
    porcoes: 6,
    dificuldade: 3,
    schemaVersion: 1,
    ...over,
  }
}

function input(over: Partial<ResolveInput> = {}): ResolveInput {
  return {
    recipe: recipeRow(),
    translations: [ptOriginal, enReliableDiffering],
    ingredients,
    tags: ['festiva'],
    requestLocale: 'en-US',
    ...over,
  }
}

// ── resolveName ──────────────────────────────────────────────────────────────

describe('resolveName — original primário, tradução assistiva', () => {
  it('AC#1 positivo: tradução confiável e diferente ⇒ "Original (Tradução)"', () => {
    const name = resolveName({
      originalLocale: 'pt-BR',
      requestLocale: 'en-US',
      translations: [ptOriginal, enReliableDiffering],
    })
    expect(name).toBe('Feijoada (Black Bean Stew)')
  })

  it('AC#1 negativo: tradução não revisada ⇒ original NU, sem vazar texto', () => {
    const enUnreliable: TranslationRow = {
      ...enReliableDiffering,
      titulo: 'Black Bean Stew',
      provenance: 'automatica_nao_revisada',
    }
    const name = resolveName({
      originalLocale: 'pt-BR',
      requestLocale: 'en-US',
      translations: [ptOriginal, enUnreliable],
    })
    expect(name).toBe('Feijoada')
    expect(name).not.toContain('(')
    expect(name).not.toContain('Black Bean Stew')
  })

  it('AC#2 mesmo locale: requestLocale === originalLocale ⇒ original sem parênteses', () => {
    const name = resolveName({
      originalLocale: 'pt-BR',
      requestLocale: 'pt-BR',
      translations: [ptOriginal, enReliableDiffering],
    })
    expect(name).toBe('Feijoada')
    expect(name).not.toContain('(')
  })

  it('AC#2 redundante: tradução confiável IGUAL ao original ⇒ sem parênteses', () => {
    const enEqual: TranslationRow = {
      ...enReliableDiffering,
      titulo: 'Feijoada', // igual ao original
      provenance: 'automatica_revisada',
    }
    const name = resolveName({
      originalLocale: 'pt-BR',
      requestLocale: 'en-US',
      translations: [ptOriginal, enEqual],
    })
    expect(name).toBe('Feijoada')
    expect(name).not.toContain('(')
  })

  it('sem tradução do locale pedido ⇒ original nu', () => {
    const name = resolveName({
      originalLocale: 'pt-BR',
      requestLocale: 'fr-FR',
      translations: [ptOriginal, enReliableDiffering],
    })
    expect(name).toBe('Feijoada')
    expect(name).not.toContain('(')
  })

  it('nunca emite parênteses vazios', () => {
    const enBlank: TranslationRow = {
      ...enReliableDiffering,
      titulo: '',
      provenance: 'automatica_revisada',
    }
    const name = resolveName({
      originalLocale: 'pt-BR',
      requestLocale: 'en-US',
      translations: [ptOriginal, enBlank],
    })
    expect(name).toBe('Feijoada')
    expect(name).not.toContain('()')
  })

  it('tradução confiável com titulo só-espaços ⇒ original NU, sem `(   )`', () => {
    const enWhitespace: TranslationRow = {
      ...enReliableDiffering,
      titulo: '   ',
      provenance: 'automatica_revisada',
    }
    const name = resolveName({
      originalLocale: 'pt-BR',
      requestLocale: 'en-US',
      translations: [ptOriginal, enWhitespace],
    })
    expect(name).toBe('Feijoada')
    expect(name).not.toContain('(')
  })
})

// ── resolveBody ──────────────────────────────────────────────────────────────

describe('resolveBody — fallback por campo para a fonte', () => {
  it('AC#1 corpo: tradução parcial cai nos campos do original', () => {
    const body = resolveBody({
      originalLocale: 'pt-BR',
      requestLocale: 'en-US',
      translations: [ptOriginal, enReliableDiffering],
    })
    expect(body.descricao).toBe('Ensopado de feijão preto com carnes.')
    expect(body.passos).toEqual(['Demolhe o feijão.', 'Cozinhe as carnes.'])
    expect(body.notas).toBe('Sirva com arroz.')
  })

  it('usa o valor do locale pedido quando presente', () => {
    const enFull: TranslationRow = {
      ...enReliableDiffering,
      descricao: 'Black bean and pork stew.',
      passos: ['Soak the beans.'],
      notas: 'Serve with rice.',
    }
    const body = resolveBody({
      originalLocale: 'pt-BR',
      requestLocale: 'en-US',
      translations: [ptOriginal, enFull],
    })
    expect(body.descricao).toBe('Black bean and pork stew.')
    expect(body.passos).toEqual(['Soak the beans.'])
    expect(body.notas).toBe('Serve with rice.')
  })

  it('campo ausente em ambos ⇒ null, nunca string vazia', () => {
    const ptMinimal: TranslationRow = {
      locale: 'pt-BR',
      titulo: 'Água',
      descricao: null,
      passos: null,
      notas: null,
      provenance: 'escrita_por_pessoa',
      stale: false,
    }
    const body = resolveBody({
      originalLocale: 'pt-BR',
      requestLocale: 'en-US',
      translations: [ptMinimal],
    })
    expect(body.descricao).toBeNull()
    expect(body.passos).toBeNull()
    expect(body.notas).toBeNull()
  })
})

// ── resolveFacets ────────────────────────────────────────────────────────────

describe('resolveFacets — restricoes ausente quando vazio (AC#3)', () => {
  it('restricoes vazio ⇒ chave AUSENTE; cozinha/categoria/tags presentes', () => {
    const facets = resolveFacets({
      cozinha: 'brasileira',
      categoria: 'prato_principal',
      tags: ['festiva'],
      restricoes: [],
    })
    expect('restricoes' in facets).toBe(false)
    expect(facets.cozinha).toBe('brasileira')
    expect(facets.categoria).toBe('prato_principal')
    expect(facets.tags).toEqual(['festiva'])
  })

  it('restricoes não-vazio ⇒ chave PRESENTE', () => {
    const facets = resolveFacets({
      cozinha: 'brasileira',
      categoria: 'prato_principal',
      tags: [],
      restricoes: ['sem_gluten', 'vegano'],
    })
    expect('restricoes' in facets).toBe(true)
    expect(facets.restricoes).toEqual(['sem_gluten', 'vegano'])
  })
})

// ── resolveRecipeView ────────────────────────────────────────────────────────

describe('resolveRecipeView — vista completa', () => {
  it('AC#4: a vista sempre carrega origin (selo) e schemaVersion', () => {
    const view = resolveRecipeView(input())
    expect(view.origin).toBe('catalog')
    expect(view.schemaVersion).toBe(1)
  })

  it('AC#3 na vista: restricoes vazio omite a chave das facetas', () => {
    const view = resolveRecipeView(input({ recipe: recipeRow({ restricoes: [] }) }))
    expect('restricoes' in view.facets).toBe(false)
    expect(view.facets.cozinha).toBe('brasileira')
    expect(view.facets.categoria).toBe('prato_principal')
  })

  it('AC#5: invariantes (porcoes/dificuldade/ingredientes) idênticas entre locales', () => {
    const ptView = resolveRecipeView(input({ requestLocale: 'pt-BR' }))
    const enView = resolveRecipeView(input({ requestLocale: 'en-US' }))

    // Invariantes idênticas qualquer que seja o requestLocale.
    expect(enView.porcoes).toBe(ptView.porcoes)
    expect(enView.dificuldade).toBe(ptView.dificuldade)
    expect(enView.ingredients).toEqual(ptView.ingredients)
    expect(enView.origin).toBe(ptView.origin)
    expect(enView.schemaVersion).toBe(ptView.schemaVersion)

    // quantidade permanece STRING de escala-3 (não número).
    expect(ptView.ingredients[0].quantidade).toBe('2.500')
    expect(typeof ptView.ingredients[0].quantidade).toBe('string')

    // ... enquanto o nome DIFERE entre locales.
    expect(ptView.name).toBe('Feijoada')
    expect(enView.name).toBe('Feijoada (Black Bean Stew)')
    expect(enView.name).not.toBe(ptView.name)
  })

  // Fixture com contradição: item com alérgeno `trigo` numa Receita marcada `sem_gluten`.
  const ingredientsComTrigo: IngredientItem[] = [
    { ordem: 0, quantidade: '500', unidade: 'g', rawText: null, alergenos: ['trigo'] },
  ]

  it('U-view-1: contradição (trigo + sem_gluten) ⇒ avisos PRESENTE, com mensagem renderizada com o rótulo amigável', () => {
    const view = resolveRecipeView(
      input({
        recipe: recipeRow({ restricoes: ['sem_gluten'] }),
        ingredients: ingredientsComTrigo,
        requestLocale: 'pt-BR',
      }),
    )
    expect(view.avisos).toBeDefined()
    expect(view.avisos).toHaveLength(1)
    const aviso = view.avisos![0]
    // Códigos repassados 1:1 do motor.
    expect(aviso.kind).toBe('contradicao')
    expect(aviso.restricao).toBe('sem_gluten')
    expect(aviso.alergeno).toBe('trigo')
    // Mensagem REALMENTE renderizada: contém o RÓTULO amigável "sem glúten", não o código cru.
    expect(aviso.mensagem).toContain('sem glúten')
    expect(aviso.mensagem).not.toContain('sem_gluten')
    expect(aviso.mensagem).toContain('trigo')
    // Não é fallback de placeholder não-interpolado.
    expect(aviso.mensagem).not.toContain('{restricao}')
    expect(aviso.mensagem).not.toContain('{alergeno}')
  })

  it('U-view-2: alergenos NÃO vaza em view.ingredients (guarda do Omit)', () => {
    const view = resolveRecipeView(
      input({
        recipe: recipeRow({ restricoes: ['sem_gluten'] }),
        ingredients: ingredientsComTrigo,
        requestLocale: 'pt-BR',
      }),
    )
    expect('alergenos' in view.ingredients[0]).toBe(false)
    expect(Object.keys(view.ingredients[0]).sort()).toEqual([
      'ordem',
      'quantidade',
      'rawText',
      'unidade',
    ])
  })
})

// ── #23 AC3: staleNotice (aviso de tradução obsoleta) ──────────────────────────

/** Tradução en-US STALE (origem mudou depois): provoca o aviso. */
const enStale: TranslationRow = {
  locale: 'en-US',
  titulo: 'Black Bean Stew',
  descricao: null,
  passos: null,
  notas: null,
  provenance: 'automatica_revisada',
  stale: true,
}

describe('resolveRecipeView — staleNotice #23 (AC3)', () => {
  it('AC3: tradução pedida stale ⇒ staleNotice RENDERIZADO (pt-BR)', () => {
    const view = resolveRecipeView(
      input({
        recipe: recipeRow({ originalLocale: 'pt-BR' }),
        translations: [ptOriginal, enStale],
        requestLocale: 'en-US',
      }),
    )
    expect(view.staleNotice).toEqual({
      locale: 'en-US',
      originalLocale: 'pt-BR',
      // TEXTO renderizado (não a chave) — impede a chave i18n de C9 de morrer.
      mensagem: MESSAGES['en-US'].traducao.staleAviso,
      verOriginalLabel: MESSAGES['en-US'].traducao.verOriginal,
    })
    // A tradução stale AINDA aparece (legível): name + body não somem.
    expect(view.name.length).toBeGreaterThan(0)
  })

  it('AC3: a frase renderizada bate o catálogo NOS DOIS locales (chaves vivas)', () => {
    // requestLocale pt-BR, original en-US (inverso): a tradução pt-BR é stale.
    const ptStale: TranslationRow = { ...ptOriginal, stale: true }
    const enOriginal: TranslationRow = { ...enStale, stale: false, provenance: 'escrita_por_pessoa' }
    const view = resolveRecipeView(
      input({
        recipe: recipeRow({ originalLocale: 'en-US' }),
        translations: [enOriginal, ptStale],
        requestLocale: 'pt-BR',
      }),
    )
    expect(view.staleNotice?.mensagem).toBe(MESSAGES['pt-BR'].traducao.staleAviso)
    expect(view.staleNotice?.verOriginalLabel).toBe(MESSAGES['pt-BR'].traducao.verOriginal)
  })

  it('AC3: origem nunca sinalizada — requestLocale === originalLocale ⇒ AUSENTE', () => {
    // Origem pt-BR automatica_nao_revisada E stale: mesmo assim, sem aviso (vê-se a origem).
    const ptStaleUnreviewed: TranslationRow = {
      ...ptOriginal,
      provenance: 'automatica_nao_revisada',
      stale: true,
    }
    const view = resolveRecipeView(
      input({
        recipe: recipeRow({ originalLocale: 'pt-BR' }),
        translations: [ptStaleUnreviewed],
        requestLocale: 'pt-BR',
      }),
    )
    expect(view.staleNotice).toBeUndefined()
  })

  it('controle negativo: tradução pedida NÃO-stale ⇒ staleNotice AUSENTE', () => {
    const view = resolveRecipeView(
      input({
        recipe: recipeRow({ originalLocale: 'pt-BR' }),
        translations: [ptOriginal, { ...enStale, stale: false }],
        requestLocale: 'en-US',
      }),
    )
    expect(view.staleNotice).toBeUndefined()
  })
})

// ── #21 (#289): vínculo perdido — a base da derivada foi apagada ────────────────

/** Diff congelado mínimo (forma versionada do domínio). */
const diffCongelado = {
  v: 1 as const,
  ingredientes: { adicionados: [], removidos: [], quantidadeAlterada: [] },
  restricoes: { adicionadas: [], removidas: [] },
  campos: {},
}

describe('resolveRecipeView — vinculoPerdido #21 (#289)', () => {
  it('derivada do DONO com parent NULL + diff presente ⇒ vinculoPerdido=true', () => {
    const view = resolveRecipeView(
      input({
        recipe: recipeRow({
          ownerId: 'u-1',
          lineageKind: 'edited',
          parentRecipeId: null, // base apagada (FK ON DELETE set null)
          derivedDiff: diffCongelado,
        }),
        viewerId: 'u-1',
      }),
    )
    expect(view.vinculoPerdido).toBe(true)
    // O diff CONTINUA presente (conteúdo completo; só o ponteiro sumiu) — #289.
    expect(view.derivedDiff).toEqual(diffCongelado)
  })

  it('derivada do DONO com parent AINDA presente ⇒ vinculoPerdido AUSENTE', () => {
    const view = resolveRecipeView(
      input({
        recipe: recipeRow({
          ownerId: 'u-1',
          lineageKind: 'edited',
          parentRecipeId: 'base-1', // base ainda existe
          derivedDiff: diffCongelado,
        }),
        viewerId: 'u-1',
      }),
    )
    expect(view.vinculoPerdido).toBeUndefined()
    expect(view.derivedDiff).toEqual(diffCongelado)
  })

  it('owner-gated: NÃO-dono não vê vinculoPerdido (espelha derivedDiff)', () => {
    const view = resolveRecipeView(
      input({
        recipe: recipeRow({
          ownerId: 'u-1',
          lineageKind: 'edited',
          parentRecipeId: null,
          derivedDiff: diffCongelado,
        }),
        viewerId: 'u-2', // outro
      }),
    )
    expect(view.vinculoPerdido).toBeUndefined()
    expect(view.derivedDiff).toBeUndefined()
  })

  it('receita NÃO-derivada (sem diff) ⇒ vinculoPerdido AUSENTE mesmo com parent NULL', () => {
    const view = resolveRecipeView(
      input({
        recipe: recipeRow({ ownerId: 'u-1', parentRecipeId: null, lineageKind: null, derivedDiff: null }),
        viewerId: 'u-1',
      }),
    )
    expect(view.vinculoPerdido).toBeUndefined()
  })
})

// ── #129/Autoria: byline "por <name>" na vista (PÚBLICO, não owner-gated) ───────

describe('resolveRecipeView — Autoria (byline #129)', () => {
  it('autor presente ⇒ `author { name, handle }` na vista (visível p/ QUALQUER leitor, sem viewerId)', () => {
    const view = resolveRecipeView(
      input({
        recipe: recipeRow({ origin: 'ai_chat', ownerId: 'u-1' }),
        // anônimo (sem viewerId): a Autoria é PÚBLICA — não depende de sessão/ownership.
        author: { name: 'Ana Maria', handle: 'ana-maria' },
      }),
    )
    expect(view.author).toEqual({ name: 'Ana Maria', handle: 'ana-maria' })
    // Não vaza ownership: anônimo não vê canManage/visibility.
    expect(view.canManage).toBeUndefined()
    expect(view.visibility).toBeUndefined()
  })

  it('sem autor (Catálogo/sistema) ⇒ `author` AUSENTE (sem crédito falso)', () => {
    const view = resolveRecipeView(input({ recipe: recipeRow({ origin: 'catalog', ownerId: null }) }))
    expect('author' in view).toBe(false)
  })

  it('autor parcial (handle NULL) ⇒ `author` AUSENTE (nunca crédito pela metade)', () => {
    const view = resolveRecipeView(
      input({
        recipe: recipeRow({ origin: 'ai_chat', ownerId: 'u-1' }),
        author: { name: 'Sem Handle', handle: null },
      }),
    )
    expect('author' in view).toBe(false)
  })
})

// ── Imagem da receita: projeção pública + gate de moderação (#130/#132/#133) ─────
const BLOB = 'https://abc.public.blob.vercel-storage.com/recipes/x.webp'

describe('resolveRecipeView — Imagem (#130/#132/#133)', () => {
  it('imagem não moderada ⇒ `imageUrl` na vista p/ QUALQUER leitor (anônimo, sem viewerId)', () => {
    const view = resolveRecipeView(input({ recipe: recipeRow({ ownerId: 'u-1' }), imageUrl: BLOB }))
    expect(view.imageUrl).toBe(BLOB)
    expect(view.imageAiGenerated).toBeUndefined() // foto do usuário ⇒ sem selo
    expect(view.canManage).toBeUndefined() // anônimo: não vaza gestão
  })

  it('imagem ai_generated não moderada ⇒ `imageUrl` + selo `imageAiGenerated` (público)', () => {
    const view = resolveRecipeView(
      input({ recipe: recipeRow({ ownerId: 'u-1' }), imageUrl: BLOB, imageAiGenerated: true }),
    )
    expect(view.imageUrl).toBe(BLOB)
    expect(view.imageAiGenerated).toBe(true)
  })

  it('#133 MODERADA + anônimo (não-dono) ⇒ `imageUrl` E selo AUSENTES (some do público)', () => {
    const view = resolveRecipeView(
      input({
        recipe: recipeRow({ ownerId: 'u-1' }),
        imageUrl: BLOB,
        imageAiGenerated: true,
        imageModerated: true,
        // sem viewerId (anônimo) ⇒ canManage falso ⇒ esconde a foto e o selo
      }),
    )
    expect('imageUrl' in view).toBe(false)
    expect('imageAiGenerated' in view).toBe(false)
  })

  it('#133 MODERADA + não-dono LOGADO ⇒ AUSENTES (gate por ownership, não por sessão)', () => {
    const view = resolveRecipeView(
      input({
        recipe: recipeRow({ ownerId: 'u-1' }),
        viewerId: 'u-2', // logado, mas NÃO é o dono
        imageUrl: BLOB,
        imageAiGenerated: true,
        imageModerated: true,
      }),
    )
    expect('imageUrl' in view).toBe(false)
    expect('imageAiGenerated' in view).toBe(false)
    expect(view.canManage).toBeUndefined() // não-dono não gerencia
  })

  it('#133 MODERADA + DONO (canManage) ⇒ `imageUrl` + selo PRESENTES (Owner ainda vê)', () => {
    const view = resolveRecipeView(
      input({
        recipe: recipeRow({ ownerId: 'u-1' }),
        viewerId: 'u-1', // o próprio dono
        imageUrl: BLOB,
        imageAiGenerated: true,
        imageModerated: true,
      }),
    )
    expect(view.canManage).toBe(true)
    expect(view.imageUrl).toBe(BLOB) // a moderação esconde do público, não apaga p/ o Owner
    expect(view.imageAiGenerated).toBe(true)
  })

  it('sem imagem ⇒ `imageUrl`/`imageAiGenerated` AUSENTES (ausente ≠ vazio), moderação irrelevante', () => {
    const view = resolveRecipeView(input({ recipe: recipeRow({ ownerId: 'u-1' }), imageModerated: true }))
    expect('imageUrl' in view).toBe(false)
    expect('imageAiGenerated' in view).toBe(false)
  })
})

// ── #134: imageGenEnabled — flag de geração-por-IA OWNER-GATED ───────────────────
describe('resolveRecipeView — imageGenEnabled (#134, owner-gated)', () => {
  it('DONO (canManage) + flag presente ⇒ projeta imageGenEnabled (true e false 1:1)', () => {
    const ligado = resolveRecipeView(
      input({ recipe: recipeRow({ ownerId: 'u-1' }), viewerId: 'u-1', imageGenEnabled: true }),
    )
    expect(ligado.canManage).toBe(true)
    expect(ligado.imageGenEnabled).toBe(true)

    const desligado = resolveRecipeView(
      input({ recipe: recipeRow({ ownerId: 'u-1' }), viewerId: 'u-1', imageGenEnabled: false }),
    )
    expect(desligado.imageGenEnabled).toBe(false) // false sai (não é "ausente ≠ vazio" — é o valor)
  })

  it('NÃO-dono (viewerId ≠ ownerId) ⇒ AUSENTE mesmo com o flag setado (não vaza a config)', () => {
    const view = resolveRecipeView(
      input({ recipe: recipeRow({ ownerId: 'u-1' }), viewerId: 'u-2', imageGenEnabled: false }),
    )
    expect(view.canManage).toBeUndefined()
    expect('imageGenEnabled' in view).toBe(false)
  })

  it('anônimo (sem viewerId) ⇒ AUSENTE', () => {
    const view = resolveRecipeView(
      input({ recipe: recipeRow({ ownerId: 'u-1' }), imageGenEnabled: true }),
    )
    expect('imageGenEnabled' in view).toBe(false)
  })

  it('DONO mas o server NÃO carregou a flag (input omite) ⇒ AUSENTE (só sai quando pedido)', () => {
    const view = resolveRecipeView(input({ recipe: recipeRow({ ownerId: 'u-1' }), viewerId: 'u-1' }))
    expect(view.canManage).toBe(true)
    expect('imageGenEnabled' in view).toBe(false)
  })
})
