import { describe, expect, it } from 'vitest'
import type { Origin, TranslationProvenance } from '@/domain/recipe'
import { projectResult, type SearchHitRow } from '@/domain/recipe-search-read'
import { resolveRecipeListItem, type RecipeListRow } from '@/domain/recipe-list-read'
import { projectProfileRecipe, type ProfileRecipeRow } from '@/domain/recipe-profile-read'
import type { TranslationNameRow } from '@/domain/recipe-read'

/**
 * Selo "texto gerado por IA" nos cards (#618): os três read models de card (Busca/Feed/trilhos via
 * `projectResult`, "Minhas receitas"/Salvos via `resolveRecipeListItem`, perfil via `projectProfileRecipe`)
 * aplicam a MESMA regra da página da receita (`resolveAiTextSignal`, #597): `ai_*` sempre; `user_edited`
 * enquanto a tradução do `original_locale` ainda é `automatica_nao_revisada`; catálogo e importada nunca.
 * "ausente ≠ vazio": sem o selo, a chave `textAiGenerated` nem existe.
 */

type Caso = {
  nome: string
  origin: Origin
  original: TranslationProvenance
  /** Proveniência de uma tradução en-US ao lado (o selo só olha o idioma original). */
  outra?: TranslationProvenance
  selo: boolean
}

const CASOS: Caso[] = [
  { nome: 'ai_structured', origin: 'ai_structured', original: 'escrita_por_pessoa', selo: true },
  { nome: 'ai_chat', origin: 'ai_chat', original: 'automatica_revisada', selo: true },
  { nome: 'derivada/clone com o texto da IA', origin: 'user_edited', original: 'automatica_nao_revisada', selo: true },
  { nome: 'derivada reescrita', origin: 'user_edited', original: 'escrita_por_pessoa', selo: false },
  {
    nome: 'derivada reescrita com tradução automática em outro idioma',
    origin: 'user_edited',
    original: 'escrita_por_pessoa',
    outra: 'automatica_nao_revisada',
    selo: false,
  },
  { nome: 'catálogo', origin: 'catalog', original: 'automatica_nao_revisada', selo: false },
  { nome: 'importada da web', origin: 'web_imported', original: 'automatica_nao_revisada', selo: false },
]

function translations(c: Caso): TranslationNameRow[] {
  const rows: TranslationNameRow[] = [{ locale: 'pt-BR', titulo: 'Moqueca', provenance: c.original }]
  if (c.outra) rows.push({ locale: 'en-US', titulo: 'Moqueca stew', provenance: c.outra })
  return rows
}

/** Como o loader projeta: `requested_*` é a tradução do locale PEDIDO (no pt-BR, a própria original). */
function searchHit(c: Caso, locale: string): SearchHitRow {
  const requested =
    locale === 'pt-BR'
      ? { titulo: 'Moqueca', provenance: c.original }
      : c.outra
        ? { titulo: 'Moqueca stew', provenance: c.outra }
        : null
  return {
    recipe_id: 'r-1',
    origin: c.origin,
    original_locale: 'pt-BR',
    requested_titulo: requested?.titulo ?? null,
    requested_provenance: requested?.provenance ?? null,
    original_titulo: 'Moqueca',
    original_provenance: c.original,
    section: c.origin === 'catalog' ? 'catalogo' : 'comunidade',
    owner_id: null,
    owner_name: null,
    owner_handle: null,
    image_url: null,
    image_thumb_url: null,
    image_detail_url: null,
    image_provenance: null,
    slug: null,
  }
}

function listRow(c: Caso): RecipeListRow {
  return {
    id: 'r-1',
    origin: c.origin,
    visibility: 'public',
    resultKind: 'success',
    lineageKind: c.origin === 'user_edited' ? 'edited' : null,
    originalLocale: 'pt-BR',
    updatedAt: '2026-10-23T00:00:00.000Z',
    moderationRemovida: false,
    imageUrl: null,
    imageThumbUrl: null,
    imageDetailUrl: null,
    imageProvenance: null,
    translations: translations(c),
  }
}

function profileRow(c: Caso): ProfileRecipeRow {
  return {
    id: 'r-1',
    origin: c.origin,
    originalLocale: 'pt-BR',
    imageUrl: null,
    imageThumbUrl: null,
    imageDetailUrl: null,
    imageProvenance: null,
    translations: translations(c),
  }
}

function confere(item: object | null, selo: boolean) {
  expect(item).not.toBeNull()
  if (selo) expect(item).toHaveProperty('textAiGenerated', true)
  else expect('textAiGenerated' in item!).toBe(false)
}

describe('selo "texto gerado por IA" nos read models de card (#618)', () => {
  for (const c of CASOS) {
    it(`${c.nome} ⇒ ${c.selo ? 'com' : 'sem'} selo, nos três read models e nos dois idiomas`, () => {
      for (const locale of ['pt-BR', 'en-US']) {
        confere(projectResult(searchHit(c, locale), locale), c.selo)
        confere(resolveRecipeListItem(listRow(c), locale, 'Sem título'), c.selo)
        confere(projectProfileRecipe(profileRow(c), locale), c.selo)
      }
    })
  }

  it('o selo do texto é independente do selo da imagem: receita da IA com foto do dono leva só o do texto', () => {
    const c = CASOS[0]
    const hit = {
      ...searchHit(c, 'pt-BR'),
      image_url: 'https://x.public.blob.vercel-storage.com/recipes/foto.webp',
      image_provenance: 'user_photo',
    }
    const r = projectResult(hit, 'pt-BR')
    expect(r).toHaveProperty('textAiGenerated', true)
    expect('imageAiGenerated' in r!).toBe(false)
  })
})
