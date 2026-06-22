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
    owner_id: null,
    // #129/Autoria: catálogo/sistema não tem dono humano ⇒ ambos NULL (sem byline). Hits de
    // Comunidade sobrescrevem com `owner_name`/`owner_handle` reais.
    owner_name: null,
    owner_handle: null,
    // #130/Imagem: sem foto por default (a maioria dos hits não tem) — casos com imagem sobrescrevem.
    image_url: null,
    image_provenance: null, // #132: proveniência da imagem (ai_generated dispara o selo)
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
    expect(buildSearchResponse([], 'pt-BR')).toEqual({ minhas: [], catalogo: [], comunidade: [] })
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

  it('ts_rank/owner_id NUNCA aparecem nas chaves de SearchResult', () => {
    // hits SEM autor (owner_name/owner_handle NULL) ⇒ chave `author` AUSENTE: 5 campos exatos.
    const { catalogo, comunidade } = buildSearchResponse(
      [hit(), c3Composite],
      'pt-BR',
    )
    const expectedKeys = ['autoTranslationSignal', 'displayedTitle', 'isOwn', 'origin', 'recipeId']
    for (const result of [...catalogo, ...comunidade]) {
      const keys = Object.keys(result).sort()
      expect(keys).toEqual(expectedKeys)
      expect(keys).not.toContain('rank')
      expect(keys).not.toContain('rn')
      expect(keys).not.toContain('ts_rank')
      expect(keys).not.toContain('section')
      // LEAK-SAFETY (#116/own-label): o owner_id cru NUNCA aflora no DTO — só o booleano isOwn.
      expect(keys).not.toContain('owner_id')
      expect(keys).not.toContain('ownerId')
      // #129: SEM autor humano (catálogo/sistema) ⇒ a chave `author` não existe (sem byline falso).
      expect(keys).not.toContain('author')
    }
  })
})

// ── #129/Autoria: byline "por <name>" linkando /u/<handle> ─────────────────────

describe('buildSearchResponse — Autoria (byline #129)', () => {
  it('Receita de Comunidade com dono ⇒ `author: { name, handle }` (sem expor owner_id)', () => {
    const com = hit({
      recipe_id: 'COM',
      origin: 'ai_chat',
      original_titulo: 'Bolo da vó',
      owner_id: 'u-1',
      owner_name: 'Ana Maria',
      owner_handle: 'ana-maria',
    })
    const { comunidade } = buildSearchResponse([com], 'pt-BR')
    expect(comunidade).toHaveLength(1)
    expect(comunidade[0].author).toEqual({ name: 'Ana Maria', handle: 'ana-maria' })
    // LEAK-SAFETY: o owner_id cru NUNCA entra no DTO; só name/handle PÚBLICOS.
    const keys = Object.keys(comunidade[0])
    expect(keys).not.toContain('owner_id')
    expect(keys).not.toContain('ownerId')
  })

  it('Catálogo/sistema (owner NULL) ⇒ chave `author` AUSENTE (nada de autor falso)', () => {
    const cat = hit({ recipe_id: 'CAT', origin: 'catalog' })
    const { catalogo } = buildSearchResponse([cat], 'pt-BR')
    expect('author' in catalogo[0]).toBe(false)
  })

  it('dono presente mas name/handle parciais (um NULL) ⇒ author AUSENTE (nunca crédito pela metade)', () => {
    const partial = hit({
      recipe_id: 'P',
      origin: 'ai_chat',
      original_titulo: 'Receita órfã',
      owner_id: 'u-2',
      owner_name: 'Sem Handle',
      owner_handle: null,
    })
    const { comunidade } = buildSearchResponse([partial], 'pt-BR')
    expect('author' in comunidade[0]).toBe(false)
  })
})

// ── #130: Imagem da receita (thumbnail) projetada por projectResult ─────────────
describe('buildSearchResponse — Imagem da receita (#130)', () => {
  it('hit com image_url ⇒ `imageUrl` na projeção', () => {
    const url = 'https://abc.public.blob.vercel-storage.com/recipes/x.webp'
    const { catalogo } = buildSearchResponse([hit({ recipe_id: 'IMG', image_url: url })], 'pt-BR')
    expect(catalogo[0].imageUrl).toBe(url)
  })

  it('hit sem image_url (NULL) ⇒ chave `imageUrl` AUSENTE ("ausente ≠ vazio")', () => {
    const { catalogo } = buildSearchResponse([hit({ recipe_id: 'NOIMG', image_url: null })], 'pt-BR')
    expect('imageUrl' in catalogo[0]).toBe(false)
  })

  it('#132 selo: image_provenance ai_generated ⇒ imageAiGenerated true; leak-safe (sem provenance crua)', () => {
    const url = 'https://abc.public.blob.vercel-storage.com/recipes/ia.webp'
    const { catalogo } = buildSearchResponse([hit({ recipe_id: 'IA', image_url: url, image_provenance: 'ai_generated' })], 'pt-BR')
    expect(catalogo[0].imageAiGenerated).toBe(true)
    const keys = Object.keys(catalogo[0])
    expect(keys).not.toContain('image_provenance') // só o booleano sai; a string crua é interna
  })

  it('#132 selo: image_provenance user_photo ⇒ chave `imageAiGenerated` AUSENTE', () => {
    const url = 'https://abc.public.blob.vercel-storage.com/recipes/foto.webp'
    const { catalogo } = buildSearchResponse([hit({ recipe_id: 'FOTO', image_url: url, image_provenance: 'user_photo' })], 'pt-BR')
    expect('imageAiGenerated' in catalogo[0]).toBe(false)
  })
})

// ── #10: `consulta` ADITIVA omitida quando a lente não resolveu ─────────────────

describe('buildSearchResponse — consulta (facetas resolvidas, #10)', () => {
  it('SEM consulta ⇒ chave `consulta` AUSENTE (estado neutro byte-a-byte)', () => {
    const body = buildSearchResponse([], 'pt-BR')
    expect(body).toEqual({ minhas: [], catalogo: [], comunidade: [] })
    expect('consulta' in body).toBe(false)
  })

  it('consulta undefined ⇒ chave `consulta` AUSENTE (não emitida como undefined)', () => {
    const body = buildSearchResponse([], 'pt-BR', undefined, undefined)
    expect('consulta' in body).toBe(false)
  })

  it('COM `consulta` ⇒ chave presente, ecoada verbatim', () => {
    const consulta = { cozinhas: ['japonesa'], dificuldade: { max: 2 } }
    const body = buildSearchResponse([], 'pt-BR', undefined, consulta)
    expect(body.consulta).toEqual(consulta)
  })

  it('`consulta` presente convive com os hits agrupados', () => {
    const body = buildSearchResponse([hit()], 'pt-BR', undefined, { tags: ['leve'] })
    expect(body.catalogo).toHaveLength(1)
    expect(body.consulta).toEqual({ tags: ['leve'] })
  })
})

describe('buildSearchResponse — sugestoes (US38, #14)', () => {
  it('SEM sugestoes ⇒ chave `sugestoes` AUSENTE (estado neutro byte-a-byte)', () => {
    const body = buildSearchResponse([], 'pt-BR')
    expect(body).toEqual({ minhas: [], catalogo: [], comunidade: [] })
    expect('sugestoes' in body).toBe(false)
  })

  it('sugestoes [] ⇒ chave `sugestoes` OMITIDA (não emitida como [])', () => {
    const body = buildSearchResponse([hit()], 'pt-BR', undefined, undefined, [])
    expect('sugestoes' in body).toBe(false)
  })

  it('COM vizinhos ⇒ `sugestoes` presente, projeção de 5 campos (sem cosseno/score; com isOwn)', () => {
    const neighbor = hit({ recipe_id: 'SN', original_titulo: 'Risoto', origin: 'catalog' })
    const body = buildSearchResponse([], 'pt-BR', undefined, undefined, [neighbor])
    expect(body.sugestoes).toHaveLength(1)
    const s = body.sugestoes?.[0]
    // EXATAMENTE 5 campos — nenhum vazamento de cosseno/score/matchKind/owner_id.
    expect(Object.keys(s ?? {}).sort()).toEqual([
      'autoTranslationSignal',
      'displayedTitle',
      'isOwn',
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
    const body = buildSearchResponse([], 'pt-BR', undefined, undefined, [blank])
    // todos pulados ⇒ array vazio ⇒ chave OMITIDA.
    expect('sugestoes' in body).toBe(false)
  })

  it('`sugestoes` convive com seções e `consulta`', () => {
    const neighbor = hit({ recipe_id: 'SN', original_titulo: 'Caldo verde' })
    const body = buildSearchResponse([hit()], 'pt-BR', undefined, { tags: ['leve'] }, [neighbor])
    expect(body.catalogo).toHaveLength(1)
    expect(body.consulta).toEqual({ tags: ['leve'] })
    expect(body.sugestoes).toHaveLength(1)
  })
})

// ── #116/own-label: roteamento da seção "Minhas" via isOwn (owner == viewer) ─────

describe('buildSearchResponse — seção Minhas (#116/own-label)', () => {
  it('viewer logado: a PRÓPRIA (owner == viewer) vai p/ `minhas`, NÃO p/ comunidade', () => {
    const own = hit({
      recipe_id: 'OWN',
      origin: 'ai_chat',
      original_titulo: 'Minha receita',
      owner_id: 'viewer-1',
      section: 'comunidade',
    })
    const community = hit({
      recipe_id: 'COM',
      origin: 'ai_chat',
      original_titulo: 'Receita da comunidade',
      owner_id: 'outro-2',
      section: 'comunidade',
    })
    const cat = hit({ recipe_id: 'CAT', origin: 'catalog', owner_id: null })
    const body = buildSearchResponse([own, community, cat], 'pt-BR', 'viewer-1')

    expect(body.minhas.map((r) => r.recipeId)).toEqual(['OWN'])
    expect(body.minhas[0].isOwn).toBe(true)
    // A comunidade genuína (outro dono, público) fica na comunidade — NUNCA em minhas.
    expect(body.comunidade.map((r) => r.recipeId)).toEqual(['COM'])
    expect(body.comunidade[0].isOwn).toBe(false)
    // Catálogo (owner NULL) fica no catálogo — owner NULL nunca casa o viewerId.
    expect(body.catalogo.map((r) => r.recipeId)).toEqual(['CAT'])
    expect(body.catalogo[0].isOwn).toBe(false)
  })

  it('anônimo (viewerId undefined): `minhas` vazia; nada vira própria mesmo com owner_id', () => {
    const ownerRow = hit({
      recipe_id: 'PUB',
      origin: 'ai_chat',
      original_titulo: 'Pública de alguém',
      owner_id: 'algum-dono',
      section: 'comunidade',
    })
    const body = buildSearchResponse([ownerRow], 'pt-BR' /* viewerId undefined */)
    expect(body.minhas).toHaveLength(0)
    expect(body.comunidade.map((r) => r.recipeId)).toEqual(['PUB'])
    expect(body.comunidade[0].isOwn).toBe(false)
  })

  it('viewer logado mas SEM próprias: `minhas` vazia (busca de antes, só com a chave a mais)', () => {
    const community = hit({ recipe_id: 'COM', origin: 'ai_chat', owner_id: 'outro', section: 'comunidade' })
    const body = buildSearchResponse([community], 'pt-BR', 'viewer-1')
    expect(body.minhas).toHaveLength(0)
    expect(body.comunidade).toHaveLength(1)
  })

  it('PRÓPRIA de catálogo-origin (improvável, mas owner == viewer) ainda vai p/ minhas', () => {
    // isOwn PRECEDE classifySection: mesmo origin=catalog, se for do viewer vai p/ minhas.
    const ownCat = hit({ recipe_id: 'OC', origin: 'catalog', owner_id: 'viewer-1' })
    const body = buildSearchResponse([ownCat], 'pt-BR', 'viewer-1')
    expect(body.minhas.map((r) => r.recipeId)).toEqual(['OC'])
    expect(body.catalogo).toHaveLength(0)
  })
})

// ── #169/ADR-0019: importada da web (web_imported) é PRIVADA e do DONO ⇒ seção Minhas ──
//
// Uma importada é cópia PRIVADA do importador (owner_id = quem importou); não é "comunidade".
// O gate de leitura (viewerReadableSqlFragment) só a expõe ao próprio dono, logo na Busca ela
// SEMPRE chega com isOwn=true e cai em `minhas`. Defesa em profundidade: mesmo um hit
// web_imported que (por bug/dado inconsistente) NÃO seja do viewer NÃO pode poluir a Comunidade.
describe('buildSearchResponse — importada da web (#169, ADR-0019)', () => {
  it('web_imported do PRÓPRIO dono ⇒ `minhas` (não comunidade)', () => {
    const importada = hit({
      recipe_id: 'IMP',
      origin: 'web_imported',
      original_titulo: 'Feijoada do TudoGostoso',
      owner_id: 'viewer-1',
      section: 'comunidade', // o SQL rotula web_imported como comunidade; a TS é a verdade
    })
    const body = buildSearchResponse([importada], 'pt-BR', 'viewer-1')
    expect(body.minhas.map((r) => r.recipeId)).toEqual(['IMP'])
    expect(body.minhas[0].isOwn).toBe(true)
    expect(body.comunidade).toHaveLength(0)
  })

  it('web_imported NÃO-própria (inalcançável em prod) NUNCA cai na Comunidade', () => {
    // Inalcançável pelo gate (importada é privada), mas se um hit assim chegasse, não pode
    // virar "comunidade" — uma importada nunca é conteúdo público do pool.
    const stray = hit({
      recipe_id: 'STRAY',
      origin: 'web_imported',
      original_titulo: 'Importada de outro',
      owner_id: 'outro-dono',
      section: 'comunidade',
    })
    const body = buildSearchResponse([stray], 'pt-BR', 'viewer-1')
    expect(body.minhas).toHaveLength(0)
    expect(body.comunidade).toHaveLength(0)
    expect(body.catalogo).toHaveLength(0)
  })
})
