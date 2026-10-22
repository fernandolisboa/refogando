import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { PATCH as vocabPatch, POST as vocabPost } from '@/app/api/admin/vocabulary/route'
import { PUT as configPut } from '@/app/api/admin/config/route'
import { POST as APPROVE } from '@/app/api/curate/cozinhas/[slug]/approve/route'
import { POST as MERGE } from '@/app/api/curate/cozinhas/[slug]/merge/route'
import { POST as REJECT } from '@/app/api/curate/cozinhas/[slug]/reject/route'
import { loadLayoutAppConfig, loadLayoutCozinhaVocab } from '@/server/layout-data'
import { APP_CONFIG_TAG, COZINHA_VOCAB_TAG } from '@/server/cache-tags'
import { __clearVocabularyCache, loadVocabulary } from '@/server/vocabulary/load'
import { suggestCozinha } from '@/server/vocabulary/suggest'
import { getDb } from '@/server/deps'
import { appConfig, vocabularyTerm } from '@/db/schema'
import { COZINHA_SEED } from '@/domain/vocabulary-term'
import { seedSessionHeaders } from '../helpers/users'
import { cachedEntryCount, failRevalidateTag, revalidatedTags } from '../helpers/next-cache'

/**
 * Leituras do root layout no Data Cache com tag (achado A da auditoria de performance, handoff 67;
 * `src/server/layout-data.ts`). Contra Postgres real, com o dublê de `next/cache` (test/setup.ts).
 * Prova, para cada tag:
 *  - a leitura fica em cache (escrita por fora do app não aparece até a invalidação);
 *  - CADA escritor que muda o que o layout mostra expira a tag certa, com o perfil `'max'`
 *    (stale-while-revalidate, ver src/server/cache-tags.ts), só quando gravou (erro de validação/404 não
 *    expira; a 1ª de duas escritas gravada expira mesmo se a 2ª falhar);
 *  - quem não muda o escopo `active` (mesclar, rejeitar, o "Outra") não expira;
 *  - uma falha ao expirar não vira 500: a escrita fica gravada e a rota responde 200.
 */

const EXPIRE = 'max'
const vocabExpired = () => revalidatedTags().filter((c) => c.tag === COZINHA_VOCAB_TAG)
const configExpired = () => revalidatedTags().filter((c) => c.tag === APP_CONFIG_TAG)
const slugsOf = async () => (await loadLayoutCozinhaVocab(getDb())).map((t) => t.slug)

beforeEach(() => __clearVocabularyCache())
afterEach(() => {
  __clearVocabularyCache()
  vi.restoreAllMocks()
})

async function headersFor(role: 'admin' | 'curador', email: string): Promise<Headers> {
  return (await seedSessionHeaders({ email, role })).headers
}
function post(body: unknown, headers: Headers): Promise<Response> {
  return vocabPost(
    new Request('http://localhost/api/admin/vocabulary', { method: 'POST', headers, body: JSON.stringify(body) }),
  )
}
function patch(body: unknown, headers: Headers): Promise<Response> {
  return vocabPatch(
    new Request('http://localhost/api/admin/vocabulary', { method: 'PATCH', headers, body: JSON.stringify(body) }),
  )
}
function put(body: unknown, headers: Headers): Promise<Response> {
  return configPut(
    new Request('http://localhost/api/admin/config', { method: 'PUT', headers, body: JSON.stringify(body) }),
  )
}
function curate(
  handler: typeof APPROVE,
  action: string,
  slug: string,
  body: unknown,
  headers: Headers,
): Promise<Response> {
  return handler(
    new Request(`http://localhost/api/curate/cozinhas/${slug}/${action}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  )
}

describe('loadLayoutCozinhaVocab — vocabulário do layout com a tag refogando:vocab:cozinha', () => {
  it('lê só as ativas, na ordem do leitor, e guarda em cache', async () => {
    const seeded = [...COZINHA_SEED].sort((a, b) => a.sort - b.sort || a.slug.localeCompare(b.slug))
    expect(await slugsOf()).toEqual(seeded.map((t) => t.slug))
    expect(cachedEntryCount()).toBe(1)

    // Escrita por fora do app (sem expirar a tag): o layout segue com a lista guardada.
    await getDb().update(vocabularyTerm).set({ status: 'deprecated' }).where(eq(vocabularyTerm.slug, 'italiana'))
    expect(await slugsOf()).toContain('italiana')
  })

  it('não passa pelo cache de 30 s por instância: depois de expirar, lê o banco', async () => {
    const admin = await headersFor('admin', 'vocab-ttl@layout.test')
    // Enche o cache por instância de `loadVocabulary` e o Data Cache do layout com a mesma lista.
    await loadVocabulary(getDb(), 'cozinha', 'active')
    await slugsOf()

    expect((await post({ slug: 'georgiana', labelPtBr: 'Georgiana', labelEnUs: 'Georgian' }, admin)).status).toBe(200)

    // O leitor com TTL ainda devolve o snapshot antigo; o do layout já vê a cozinha nova.
    expect((await loadVocabulary(getDb(), 'cozinha', 'active')).map((t) => t.slug)).not.toContain('georgiana')
    expect(await slugsOf()).toContain('georgiana')
  })

  it('POST /api/admin/vocabulary expira a tag ao criar; conflito e validação não expiram', async () => {
    const admin = await headersFor('admin', 'vocab-post@layout.test')
    await slugsOf()

    expect((await post({ slug: 'italiana', labelPtBr: 'Italiana', labelEnUs: 'Italian' }, admin)).status).toBe(409)
    expect((await post({ slug: 'Não Slug', labelPtBr: 'X', labelEnUs: 'X' }, admin)).status).toBe(400)
    expect(vocabExpired()).toEqual([])

    expect((await post({ slug: 'georgiana', labelPtBr: 'Georgiana', labelEnUs: 'Georgian' }, admin)).status).toBe(200)
    expect(vocabExpired()).toEqual([{ tag: COZINHA_VOCAB_TAG, profile: EXPIRE }])
    expect(await slugsOf()).toContain('georgiana')
  })

  it('PATCH expira ao editar rótulo, nota de voz ou status; 404 e 400 não expiram', async () => {
    const admin = await headersFor('admin', 'vocab-patch@layout.test')
    await slugsOf()

    expect((await patch({ slug: 'nao-existe', labelPtBr: 'X' }, admin)).status).toBe(404)
    expect((await patch({ slug: 'italiana', labelPtBr: '   ' }, admin)).status).toBe(400)
    expect((await patch({ slug: 'italiana', status: 'sumida' }, admin)).status).toBe(400)
    expect(vocabExpired()).toEqual([])

    expect((await patch({ slug: 'italiana', labelPtBr: 'Italiana (nova)' }, admin)).status).toBe(200)
    expect(vocabExpired()).toHaveLength(1)
    const vocab = await loadLayoutCozinhaVocab(getDb())
    expect(vocab.find((t) => t.slug === 'italiana')?.labelPtBr).toBe('Italiana (nova)')

    expect((await patch({ slug: 'italiana', voiceNote: 'Massa fresca.' }, admin)).status).toBe(200)
    expect(vocabExpired()).toHaveLength(2)

    expect((await patch({ slug: 'italiana', status: 'deprecated' }, admin)).status).toBe(200)
    expect(vocabExpired()).toEqual([
      { tag: COZINHA_VOCAB_TAG, profile: EXPIRE },
      { tag: COZINHA_VOCAB_TAG, profile: EXPIRE },
      { tag: COZINHA_VOCAB_TAG, profile: EXPIRE },
    ])
    expect(await slugsOf()).not.toContain('italiana')
  })

  it('PATCH de rótulo + status numa chamada: uma expiração; status inválido barra antes de gravar', async () => {
    const admin = await headersFor('admin', 'vocab-partial@layout.test')
    // O status inválido é barrado ANTES de qualquer escrita (400), então nada grava e nada expira.
    expect((await patch({ slug: 'italiana', labelPtBr: 'Italiana 2', status: 'x' }, admin)).status).toBe(400)
    expect(vocabExpired()).toEqual([])
    // Rótulo + status válidos: duas escritas, uma expiração.
    expect((await patch({ slug: 'italiana', labelPtBr: 'Italiana 3', status: 'deprecated' }, admin)).status).toBe(200)
    expect(vocabExpired()).toHaveLength(1)
  })

  it('PATCH de rótulo + status: a 1ª escrita gravou e a 2ª falhou ⇒ 500, mas a tag expira (finally)', async () => {
    const admin = await headersFor('admin', 'vocab-second-fails@layout.test')
    await slugsOf()
    // `editCozinhaLabels` e `setCozinhaStatus` fazem um `db.update` cada: deixa passar o 1º e derruba o 2º.
    const db = getDb()
    const realUpdate = db.update.bind(db)
    let updates = 0
    vi.spyOn(db, 'update').mockImplementation(((...args: Parameters<typeof realUpdate>) => {
      updates += 1
      if (updates === 2) throw new Error('falha simulada na 2ª escrita')
      return realUpdate(...args)
    }) as typeof db.update)

    const res = await patch({ slug: 'italiana', labelPtBr: 'Italiana (meio salvo)', status: 'deprecated' }, admin)
    expect(res.status).toBe(500)
    expect(updates).toBe(2)
    vi.restoreAllMocks()

    const [row] = await getDb()
      .select({ labelPtBr: vocabularyTerm.labelPtBr, status: vocabularyTerm.status })
      .from(vocabularyTerm)
      .where(eq(vocabularyTerm.slug, 'italiana'))
    expect(row).toEqual({ labelPtBr: 'Italiana (meio salvo)', status: 'active' })
    expect(vocabExpired()).toEqual([{ tag: COZINHA_VOCAB_TAG, profile: EXPIRE }])
    expect((await loadLayoutCozinhaVocab(getDb())).find((t) => t.slug === 'italiana')?.labelPtBr).toBe(
      'Italiana (meio salvo)',
    )
  })

  it('aprovar uma sugestão expira (vira active); mesclar, rejeitar e o "Outra" não', async () => {
    const curador = await headersFor('curador', 'curate@layout.test')
    await slugsOf()

    // "Outra" grava `suggested`: fora do escopo do layout, nenhuma rota expira.
    expect(await suggestCozinha(getDb(), 'Georgiana')).toBe('georgiana')
    expect(await suggestCozinha(getDb(), 'Etíope')).toBe('etiope')
    expect(await suggestCozinha(getDb(), 'Persa')).toBe('persa')

    expect((await curate(MERGE, 'merge', 'etiope', { target: 'italiana' }, curador)).status).toBe(200)
    expect((await curate(REJECT, 'reject', 'persa', {}, curador)).status).toBe(200)
    expect(vocabExpired()).toEqual([])
    expect(await slugsOf()).not.toContain('georgiana')

    const res = await curate(APPROVE, 'approve', 'georgiana', { labelPtBr: 'Georgiana', labelEnUs: 'Georgian' }, curador)
    expect(res.status).toBe(200)
    expect(vocabExpired()).toEqual([{ tag: COZINHA_VOCAB_TAG, profile: EXPIRE }])
    expect(await slugsOf()).toContain('georgiana')
  })

  it('aprovação com falha ao expirar não vira 500: a cozinha fica active e a rota responde 200', async () => {
    const curador = await headersFor('curador', 'curate-fail@layout.test')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await suggestCozinha(getDb(), 'Georgiana')).toBe('georgiana')
    failRevalidateTag()

    const res = await curate(APPROVE, 'approve', 'georgiana', { labelPtBr: 'Georgiana', labelEnUs: 'Georgian' }, curador)
    expect(res.status).toBe(200)
    const [row] = await getDb()
      .select({ status: vocabularyTerm.status })
      .from(vocabularyTerm)
      .where(eq(vocabularyTerm.slug, 'georgiana'))
    expect(row?.status).toBe('active')
    expect(vocabExpired()).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('aprovação recusada (já resolvida) não expira', async () => {
    const curador = await headersFor('curador', 'curate-409@layout.test')
    const res = await curate(APPROVE, 'approve', 'italiana', { labelPtBr: 'I', labelEnUs: 'I' }, curador)
    expect(res.status).toBe(409)
    expect(vocabExpired()).toEqual([])
  })

  it('falha ao expirar não vira erro: a cozinha fica gravada e a rota responde 200', async () => {
    const admin = await headersFor('admin', 'vocab-fail@layout.test')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    failRevalidateTag()

    expect((await post({ slug: 'georgiana', labelPtBr: 'Georgiana', labelEnUs: 'Georgian' }, admin)).status).toBe(200)
    expect((await patch({ slug: 'georgiana', status: 'deprecated' }, admin)).status).toBe(200)
    const [row] = await getDb()
      .select({ status: vocabularyTerm.status })
      .from(vocabularyTerm)
      .where(eq(vocabularyTerm.slug, 'georgiana'))
    expect(row?.status).toBe('deprecated')
    // Só nome e código do erro (ADR-0048), nunca a mensagem.
    const line =
      '[cache-tags] falha ao expirar a tag refogando:vocab:cozinha; o valor novo espera a revalidação por tempo: erro=Error'
    expect(warn.mock.calls).toEqual([[line], [line]])
  })
})

describe('loadLayoutAppConfig — recorte da config do layout com a tag refogando:app-config', () => {
  it('sem linha: defaults ("gerar 2" desligado, sem links)', async () => {
    expect(await loadLayoutAppConfig(getDb())).toEqual({ variantEnabled: false, socialLinks: [] })
  })

  it('só os links ligados, na ordem gravada; guarda em cache até o PUT expirar', async () => {
    const admin = await headersFor('admin', 'config@layout.test')
    const links = [
      { platform: 'instagram', url: 'https://www.instagram.com/refogando', enabled: true },
      { platform: 'x', url: 'https://x.com/refogando', enabled: false },
      { platform: 'youtube', url: 'https://www.youtube.com/@refogando', label: 'Canal', enabled: true },
    ]
    expect((await put({ socialLinks: links }, admin)).status).toBe(200)
    expect(configExpired()).toEqual([{ tag: APP_CONFIG_TAG, profile: EXPIRE }])
    expect(await loadLayoutAppConfig(getDb())).toEqual({
      variantEnabled: false,
      socialLinks: [links[0], links[2]],
    })

    // Escrita por fora do app: o layout segue com o valor guardado.
    await getDb().update(appConfig).set({ socialLinks: [] })
    expect((await loadLayoutAppConfig(getDb())).socialLinks).toHaveLength(2)

    // Qualquer PUT gravado expira (mesmo de um eixo que o layout não usa) e o layout relê.
    expect((await put({ catalogDisclosure: { enabled: true, text: 'Aviso' } }, admin)).status).toBe(200)
    expect(configExpired()).toHaveLength(2)
    expect((await loadLayoutAppConfig(getDb())).socialLinks).toEqual([])
  })

  it('o liga/desliga do "gerar 2" aparece depois do PUT', async () => {
    const admin = await headersFor('admin', 'variant@layout.test')
    expect((await loadLayoutAppConfig(getDb())).variantEnabled).toBe(false)
    const variant = {
      enabled: true,
      poloA: 'tradicional',
      poloB: 'com um toque criativo',
      instrucao: 'Mantenha as duas fiéis ao pedido.',
    }
    expect((await put({ recipeVariant: variant }, admin)).status).toBe(200)
    expect((await loadLayoutAppConfig(getDb())).variantEnabled).toBe(true)
  })

  it('PUT recusado (400/403) não expira', async () => {
    const admin = await headersFor('admin', 'config-400@layout.test')
    const curador = await headersFor('curador', 'config-403@layout.test')
    expect((await put({}, admin)).status).toBe(400)
    expect((await put({ socialLinks: [] }, curador)).status).toBe(403)
    expect(configExpired()).toEqual([])
  })

  it('falha ao expirar não vira erro: a config fica gravada e o PUT responde 200', async () => {
    const admin = await headersFor('admin', 'config-fail@layout.test')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    failRevalidateTag()
    const links = [{ platform: 'instagram', url: 'https://www.instagram.com/refogando', enabled: true }]
    expect((await put({ socialLinks: links }, admin)).status).toBe(200)
    const [row] = await getDb().select({ socialLinks: appConfig.socialLinks }).from(appConfig)
    expect(row?.socialLinks).toEqual(links)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
