import { describe, expect, it } from 'vitest'
import {
  buildSearchResponse,
  displayedProvenance,
  type SearchHitRow,
} from '@/domain/recipe-search-read'

// ── Fixtures: SearchHitRow parciais com defaults sãos ──────────────────────────

function hit(over: Partial<SearchHitRow> = {}): SearchHitRow {
  return {
    recipe_id: 'r-1',
    origin: 'catalog',
    original_locale: 'pt-BR',
    requested_titulo: null,
    requested_provenance: null,
    original_titulo: 'Chili de carne',
    original_provenance: 'escrita_por_pessoa',
    section: 'catalogo',
    ...over,
  }
}

// Caso C3 (composto): original en-US NÃO-revisado + parêntese pt-BR confiável.
const c3Composite: SearchHitRow = hit({
  recipe_id: 'C3',
  origin: 'user_edited',
  original_locale: 'en-US',
  original_titulo: 'Texas Chili',
  original_provenance: 'automatica_nao_revisada',
  requested_titulo: 'Chili do Texas',
  requested_provenance: 'automatica_revisada',
  section: 'comunidade',
})

// Caso (b): original confiável + requested confiável.
const reliableBoth: SearchHitRow = hit({
  recipe_id: 'B',
  origin: 'user_edited',
  original_locale: 'pt-BR',
  original_titulo: 'Feijoada',
  original_provenance: 'escrita_por_pessoa',
  requested_titulo: 'Black Bean Stew',
  requested_provenance: 'automatica_revisada',
  section: 'comunidade',
})

// Caso (c): original AUSENTE; requested NÃO-revisado usado como base de fallback.
const originalMissing: SearchHitRow = hit({
  recipe_id: 'M',
  origin: 'ai_chat',
  original_locale: 'en-US', // a linha en-US NÃO veio (original_titulo null)
  original_titulo: null,
  original_provenance: null,
  requested_titulo: 'Chili improvisado',
  requested_provenance: 'automatica_nao_revisada',
  section: 'comunidade',
})

// Caso C2: requestLocale === originalLocale, original único NÃO-revisado.
const sameLocaleUnreviewed: SearchHitRow = hit({
  recipe_id: 'C2',
  origin: 'user_edited',
  original_locale: 'pt-BR',
  original_titulo: 'Chili secreto',
  original_provenance: 'automatica_nao_revisada',
  requested_titulo: null,
  requested_provenance: null,
  section: 'comunidade',
})

// Caso C: cross-locale, original confiável + pt-BR não-revisado NÃO-anexado.
const crossLocaleReliableBase: SearchHitRow = hit({
  recipe_id: 'C',
  origin: 'user_edited',
  original_locale: 'en-US',
  original_titulo: 'Texas Chili',
  original_provenance: 'escrita_por_pessoa',
  requested_titulo: 'Chili do Texas',
  requested_provenance: 'automatica_nao_revisada',
  section: 'comunidade',
})

// ── displayedProvenance — rastreia a linha-BASE de resolveName ─────────────────

describe('displayedProvenance — proveniência da linha-BASE (não do parêntese)', () => {
  it('(a) C3 composto: base = original en-US NÃO-revisado (parêntese confiável NÃO muda a base)', () => {
    expect(displayedProvenance(c3Composite)).toBe('automatica_nao_revisada')
  })

  it('(b) original confiável + requested confiável: base = original confiável', () => {
    expect(displayedProvenance(reliableBoth)).toBe('escrita_por_pessoa')
  })

  it('(c) original ausente: base = requested (fallback), aqui NÃO-revisado', () => {
    expect(displayedProvenance(originalMissing)).toBe('automatica_nao_revisada')
  })

  it('(d/C2) mesmo locale, original único: base = esse original', () => {
    expect(displayedProvenance(sameLocaleUnreviewed)).toBe('automatica_nao_revisada')
  })

  it('(C) cross-locale, original confiável: base = original confiável (pt-BR não-revisado não-anexado)', () => {
    expect(displayedProvenance(crossLocaleReliableBase)).toBe('escrita_por_pessoa')
  })

  it('edge ambos-NULL: devolve null (tratado como não-confiável a jusante)', () => {
    const both = hit({ original_titulo: null, original_provenance: null })
    expect(displayedProvenance(both)).toBeNull()
  })
})

// ── buildSearchResponse — sinal por base + displayedTitle via resolveName ───────

describe('buildSearchResponse — autoTranslationSignal rastreia a BASE de resolveName', () => {
  it('(a) C3 composto ⇒ displayedTitle composto MAS sinal TRUE (base não-revisada)', () => {
    const { comunidade } = buildSearchResponse([c3Composite], 'pt-BR')
    expect(comunidade).toHaveLength(1)
    expect(comunidade[0].displayedTitle).toBe('Texas Chili (Chili do Texas)')
    expect(comunidade[0].autoTranslationSignal).toBe(true)
  })

  it('(b) original confiável + requested confiável ⇒ sinal FALSE', () => {
    const { comunidade } = buildSearchResponse([reliableBoth], 'en-US')
    expect(comunidade[0].displayedTitle).toBe('Feijoada (Black Bean Stew)')
    expect(comunidade[0].autoTranslationSignal).toBe(false)
  })

  it('(c) original ausente, requested não-revisado de base ⇒ sinal TRUE; título = requested nu', () => {
    const { comunidade } = buildSearchResponse([originalMissing], 'pt-BR')
    expect(comunidade[0].displayedTitle).toBe('Chili improvisado')
    expect(comunidade[0].autoTranslationSignal).toBe(true)
  })

  it('(C2) mesmo locale, original não-revisado ⇒ sinal TRUE; título original nu', () => {
    const { comunidade } = buildSearchResponse([sameLocaleUnreviewed], 'pt-BR')
    expect(comunidade[0].displayedTitle).toBe('Chili secreto')
    expect(comunidade[0].autoTranslationSignal).toBe(true)
  })

  it('(C) cross-locale, original confiável ⇒ sinal FALSE; título = original nu (pt-BR não-anexado)', () => {
    const { comunidade } = buildSearchResponse([crossLocaleReliableBase], 'pt-BR')
    // Branch 3 de resolveName: requested pt-BR é automatica_nao_revisada ⇒ original NU.
    expect(comunidade[0].displayedTitle).toBe('Texas Chili')
    expect(comunidade[0].autoTranslationSignal).toBe(false)
  })

  it('hit do catálogo confiável ⇒ sinal FALSE na seção catalogo', () => {
    const { catalogo, comunidade } = buildSearchResponse([hit()], 'pt-BR')
    expect(comunidade).toHaveLength(0)
    expect(catalogo).toHaveLength(1)
    expect(catalogo[0].recipeId).toBe('r-1')
    expect(catalogo[0].displayedTitle).toBe('Chili de carne')
    expect(catalogo[0].origin).toBe('catalog')
    expect(catalogo[0].autoTranslationSignal).toBe(false)
  })
})

// ── Agrupamento + ordem + re-derivação de seção ────────────────────────────────

describe('buildSearchResponse — agrupamento por seção e preservação da ordem', () => {
  it('re-deriva a seção de origin (não confia em hit.section) e separa Catálogo de Comunidade', () => {
    // hit.section mente deliberadamente (comunidade) mas origin=catalog manda.
    const lyingCatalog = hit({ recipe_id: 'L', origin: 'catalog', section: 'comunidade' })
    const { catalogo, comunidade } = buildSearchResponse([lyingCatalog], 'pt-BR')
    expect(catalogo.map((r) => r.recipeId)).toEqual(['L'])
    expect(comunidade).toHaveLength(0)
  })

  it('preserva a ordem (ranking) DENTRO de cada seção vinda do SQL', () => {
    const cat1 = hit({ recipe_id: 'cat-1', origin: 'catalog' })
    const cat2 = hit({ recipe_id: 'cat-2', origin: 'catalog' })
    const com1 = hit({ recipe_id: 'com-1', origin: 'ai_chat', section: 'comunidade' })
    const com2 = hit({ recipe_id: 'com-2', origin: 'user_edited', section: 'comunidade' })
    // Ordem de entrada já é o ranking por seção (ORDER BY section, rn).
    const { catalogo, comunidade } = buildSearchResponse([cat1, cat2, com1, com2], 'pt-BR')
    expect(catalogo.map((r) => r.recipeId)).toEqual(['cat-1', 'cat-2'])
    expect(comunidade.map((r) => r.recipeId)).toEqual(['com-1', 'com-2'])
  })

  it('intercalado entre seções: cada seção mantém sua própria ordem interna', () => {
    // SQL ordena por seção, mas o agrupamento não deve depender disso entre seções.
    const com1 = hit({ recipe_id: 'com-1', origin: 'ai_chat' })
    const cat1 = hit({ recipe_id: 'cat-1', origin: 'catalog' })
    const com2 = hit({ recipe_id: 'com-2', origin: 'user_edited' })
    const cat2 = hit({ recipe_id: 'cat-2', origin: 'catalog' })
    const { catalogo, comunidade } = buildSearchResponse([com1, cat1, com2, cat2], 'pt-BR')
    expect(catalogo.map((r) => r.recipeId)).toEqual(['cat-1', 'cat-2'])
    expect(comunidade.map((r) => r.recipeId)).toEqual(['com-1', 'com-2'])
  })

  it('lista vazia ⇒ seções vazias', () => {
    expect(buildSearchResponse([], 'pt-BR')).toEqual({ catalogo: [], comunidade: [] })
  })
})

// ── Locale não suportado e edge ambos-NULL ─────────────────────────────────────

describe('buildSearchResponse — defesas (locale, edge ambos-NULL, ts_rank)', () => {
  it('locale não suportado ⇒ cai em DEFAULT_LOCALE (pt-BR) sem quebrar', () => {
    // requestLocale lixo: o módulo cai em DEFAULT_LOCALE. Como o original é pt-BR e
    // não há tradução do "locale pedido", resolveName devolve o original nu.
    const { catalogo } = buildSearchResponse([hit()], 'xx-YY')
    expect(catalogo[0].displayedTitle).toBe('Chili de carne')
    expect(catalogo[0].autoTranslationSignal).toBe(false)
  })

  it('edge ambos-NULL ⇒ hit OMITIDO (sem tradução exibível ⇒ não empurra título em branco)', () => {
    const both = hit({
      recipe_id: 'E',
      original_titulo: null,
      original_provenance: null,
      requested_titulo: null,
      requested_provenance: null,
    })
    const { catalogo, comunidade } = buildSearchResponse([both], 'pt-BR')
    expect(catalogo).toHaveLength(0)
    expect(comunidade).toHaveLength(0)
  })

  it('ts_rank NUNCA aparece nas chaves de SearchResult', () => {
    const { catalogo, comunidade } = buildSearchResponse(
      [hit(), c3Composite],
      'pt-BR',
    )
    const expectedKeys = ['autoTranslationSignal', 'displayedTitle', 'origin', 'recipeId']
    for (const result of [...catalogo, ...comunidade]) {
      const keys = Object.keys(result).sort()
      expect(keys).toEqual(expectedKeys)
      expect(keys).not.toContain('rank')
      expect(keys).not.toContain('rn')
      expect(keys).not.toContain('ts_rank')
      expect(keys).not.toContain('section')
    }
  })
})

// ── #10: `consulta` ADITIVA omitida quando a lente não resolveu ─────────────────

describe('buildSearchResponse — consulta (facetas resolvidas, #10)', () => {
  it('SEM 3º arg ⇒ chave `consulta` AUSENTE (estado neutro byte-a-byte)', () => {
    const body = buildSearchResponse([], 'pt-BR')
    expect(body).toEqual({ catalogo: [], comunidade: [] })
    expect('consulta' in body).toBe(false)
  })

  it('3º arg undefined ⇒ chave `consulta` AUSENTE (não emitida como undefined)', () => {
    const body = buildSearchResponse([], 'pt-BR', undefined)
    expect('consulta' in body).toBe(false)
  })

  it('COM `consulta` ⇒ chave presente, ecoada verbatim', () => {
    const consulta = { cozinhas: ['japonesa'], dificuldade: { max: 2 } }
    const body = buildSearchResponse([], 'pt-BR', consulta)
    expect(body.consulta).toEqual(consulta)
  })

  it('`consulta` presente convive com os hits agrupados', () => {
    const body = buildSearchResponse([hit()], 'pt-BR', { tags: ['leve'] })
    expect(body.catalogo).toHaveLength(1)
    expect(body.consulta).toEqual({ tags: ['leve'] })
  })
})

describe('buildSearchResponse — sugestoes (US38, #14)', () => {
  it('SEM 4º arg ⇒ chave `sugestoes` AUSENTE (estado neutro byte-a-byte)', () => {
    const body = buildSearchResponse([], 'pt-BR')
    expect(body).toEqual({ catalogo: [], comunidade: [] })
    expect('sugestoes' in body).toBe(false)
  })

  it('4º arg [] ⇒ chave `sugestoes` OMITIDA (não emitida como [])', () => {
    const body = buildSearchResponse([hit()], 'pt-BR', undefined, [])
    expect('sugestoes' in body).toBe(false)
  })

  it('COM vizinhos ⇒ `sugestoes` presente, projeção de 4 campos (sem cosseno/score)', () => {
    const neighbor = hit({ recipe_id: 'SN', original_titulo: 'Risoto', origin: 'catalog' })
    const body = buildSearchResponse([], 'pt-BR', undefined, [neighbor])
    expect(body.sugestoes).toHaveLength(1)
    const s = body.sugestoes?.[0]
    // EXATAMENTE 4 campos — nenhum vazamento de cosseno/score/matchKind.
    expect(Object.keys(s ?? {}).sort()).toEqual([
      'autoTranslationSignal',
      'displayedTitle',
      'origin',
      'recipeId',
    ])
    expect(s?.recipeId).toBe('SN')
    expect(s?.displayedTitle).toBe('Risoto')
  })

  it('vizinho sem título exibível é PULADO (nunca tela quebrada)', () => {
    const blank = hit({
      recipe_id: 'X',
      original_titulo: null,
      original_provenance: null,
      requested_titulo: null,
      requested_provenance: null,
    })
    const body = buildSearchResponse([], 'pt-BR', undefined, [blank])
    // todos pulados ⇒ array vazio ⇒ chave OMITIDA.
    expect('sugestoes' in body).toBe(false)
  })

  it('`sugestoes` convive com seções e `consulta`', () => {
    const neighbor = hit({ recipe_id: 'SN', original_titulo: 'Caldo verde' })
    const body = buildSearchResponse([hit()], 'pt-BR', { tags: ['leve'] }, [neighbor])
    expect(body.catalogo).toHaveLength(1)
    expect(body.consulta).toEqual({ tags: ['leve'] })
    expect(body.sugestoes).toHaveLength(1)
  })
})
