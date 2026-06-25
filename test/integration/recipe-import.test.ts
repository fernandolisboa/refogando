import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { POST } from '@/app/api/recipes/import/route'
import { GET } from '@/app/api/recipes/[id]/route'
import { getDb, setRecipeImporter, setEmbedder } from '@/server/deps'
import { FakeRecipeImporter, CANONICAL_IMPORTED_RECIPE } from '@/server/import/recipe-importer'
import { FakeEmbedder } from '@/server/embedding/embedder'
import { recipe, recipeTranslation, recipeIngredient, appConfig } from '@/db/schema'
import { EMBEDDING_DIMENSIONS } from '@/db/schema'
import type { RecipeView } from '@/domain/recipe-read'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Importar receita da web (#165, ADR-0019) pela porta MAIS ALTA (POST /api/recipes/import) com
 * `FakeRecipeImporter` injetado (NUNCA toca a rede). `setup.ts` aponta o DI pro Postgres descartável
 * e reseta seams/trunca antes de cada teste. Cobre: sucesso (web_imported privada, atribuição gravada,
 * owner correto, ingredientes/tradução), anon→401, sem-JSON-LD→422, idioma não suportado→422,
 * url inválida→400, GUARD de SSRF/allowlist (#164: domínio fora da allowlist → 403, ANTES do seam).
 *
 * O domínio de origem `exemplo.com` é LIBERADO na allowlist do singleton `app_config` ANTES de cada
 * caso de sucesso/422 (sem isso, o guard de SSRF recusaria com 403 — allowlist vazia é fail-closed).
 */

const SRC = 'https://exemplo.com/receitas/bolo'

/** Libera o domínio `exemplo.com` na allowlist (singleton app_config) — pré-condição do import. */
async function seedAllowlist(domains: string[] = ['exemplo.com']): Promise<void> {
  await getDb()
    .insert(appConfig)
    .values({ id: true, webSearchEnabled: true, webSearchAllowlist: domains })
    .onConflictDoUpdate({
      target: appConfig.id,
      set: { webSearchEnabled: true, webSearchAllowlist: domains },
    })
}

function withJson(base?: Headers): Headers {
  const h = base ? new Headers(base) : new Headers()
  h.set('content-type', 'application/json')
  return h
}

function importPost(body: unknown, headers?: Headers): Promise<Response> {
  return POST(
    new Request('http://localhost/api/recipes/import', {
      method: 'POST',
      headers: withJson(headers),
      body: JSON.stringify(body),
    }),
  )
}

async function loadRecipe(id: string) {
  const [row] = await getDb()
    .select({
      origin: recipe.origin,
      visibility: recipe.visibility,
      ownerId: recipe.ownerId,
      originalLocale: recipe.originalLocale,
      sourceUrl: recipe.sourceUrl,
      sourceName: recipe.sourceName,
      imageId: recipe.imageId,
    })
    .from(recipe)
    .where(eq(recipe.id, id))
  return row
}

describe('POST /api/recipes/import (#165)', () => {
  it('sucesso: cria web_imported PRIVADA, owner=usuário, atribuição gravada, tradução + ingredientes', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'import-ok@ex.com' })
    await seedAllowlist() // exemplo.com liberado (sem isso o guard de SSRF recusa com 403)
    setRecipeImporter(new FakeRecipeImporter()) // receita canônica fixa (pt-BR)
    setEmbedder(new FakeEmbedder(EMBEDDING_DIMENSIONS))

    const res = await importPost({ url: SRC }, headers)
    expect(res.status).toBe(201)
    const bodyJson = (await res.json()) as { recipeId: string; visibility: string }
    expect(bodyJson.visibility).toBe('private')

    const row = await loadRecipe(bodyJson.recipeId)
    expect(row.origin).toBe('web_imported')
    expect(row.visibility).toBe('private')
    expect(row.ownerId).toBe(userId)
    expect(row.originalLocale).toBe('pt-BR')
    expect(row.sourceUrl).toBe(SRC) // URL de origem gravada p/ atribuição
    expect(row.sourceName).toBe(CANONICAL_IMPORTED_RECIPE.sourceName)
    // #272/ADR-0019: camada PROTEGIDA não copiada — importada nasce SEM imagem.
    expect(row.imageId).toBeNull()

    // Tradução do locale de origem, marcada automática-não-revisada (conteúdo externo copiado).
    const [tr] = await getDb()
      .select({
        titulo: recipeTranslation.titulo,
        descricao: recipeTranslation.descricao,
        slug: recipeTranslation.slug,
        provenance: recipeTranslation.provenance,
      })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.recipeId, bodyJson.recipeId), eq(recipeTranslation.locale, 'pt-BR')))
    expect(tr.titulo).toBe(CANONICAL_IMPORTED_RECIPE.titulo)
    // #272/ADR-0019: headnote (`description`) NÃO copiado — nasce em branco (NULL).
    expect(tr.descricao).toBeNull()
    // Slug por idioma (#229): materializado na importação (write-path), não NULL.
    expect(tr.slug).toBe('bolo-de-cenoura')
    expect(tr.provenance).toBe('automatica_nao_revisada')

    // Ingredientes preservados na ordem, com rawText + qty/unidade best-effort.
    const ings = await getDb()
      .select({ ordem: recipeIngredient.ordem, rawText: recipeIngredient.rawText, unidade: recipeIngredient.unidade })
      .from(recipeIngredient)
      .where(eq(recipeIngredient.recipeId, bodyJson.recipeId))
      .orderBy(recipeIngredient.ordem)
    expect(ings.length).toBe(CANONICAL_IMPORTED_RECIPE.ingredientes.length)
    expect(ings[0].rawText).toBe(CANONICAL_IMPORTED_RECIPE.ingredientes[0].rawText)
  })

  it('#169: o detalhe da importada (lida pelo DONO) traz `source` (atribuição) e SEM `author`', async () => {
    const { headers } = await seedSessionHeaders({ email: 'import-detail@ex.com' })
    await seedAllowlist()
    setRecipeImporter(new FakeRecipeImporter())
    setEmbedder(new FakeEmbedder(EMBEDDING_DIMENSIONS))

    const res = await importPost({ url: SRC }, headers)
    expect(res.status).toBe(201)
    const { recipeId } = (await res.json()) as { recipeId: string }

    // A importada é PRIVADA: só o dono lê (gate de leitura). GET com a sessão do dono.
    const getRes = await GET(
      new Request(`http://localhost/api/recipes/${recipeId}?locale=pt-BR`, { headers }),
      { params: Promise.resolve({ id: recipeId }) },
    )
    expect(getRes.status).toBe(200)
    const view = (await getRes.json()) as RecipeView

    // Atribuição à FONTE presente (url + name), substituindo a Autoria humana.
    expect(view.origin).toBe('web_imported')
    expect(view.source).toEqual({ url: SRC, name: CANONICAL_IMPORTED_RECIPE.sourceName })
    expect('author' in view).toBe(false)
  })

  it('anon → 401 (zero efeito: nenhuma Receita criada)', async () => {
    setRecipeImporter(new FakeRecipeImporter())
    const res = await importPost({ url: SRC }) // sem headers de sessão
    expect(res.status).toBe(401)
    const all = await getDb().select({ id: recipe.id }).from(recipe)
    expect(all.length).toBe(0)
  })

  it('sem JSON-LD confiável → 422, não importa', async () => {
    const { headers } = await seedSessionHeaders({ email: 'import-nojsonld@ex.com' })
    await seedAllowlist()
    setRecipeImporter(new FakeRecipeImporter(undefined, 'no_jsonld'))

    const res = await importPost({ url: SRC }, headers)
    expect(res.status).toBe(422)
    const bodyJson = (await res.json()) as { error: string }
    expect(bodyJson.error).toBe('no_jsonld')
    const all = await getDb().select({ id: recipe.id }).from(recipe)
    expect(all.length).toBe(0)
  })

  it('idioma fora de PT/EN → 422, não importa', async () => {
    const { headers } = await seedSessionHeaders({ email: 'import-locale@ex.com' })
    await seedAllowlist()
    setRecipeImporter(new FakeRecipeImporter(undefined, 'unsupported_locale'))

    const res = await importPost({ url: SRC }, headers)
    expect(res.status).toBe(422)
    const bodyJson = (await res.json()) as { error: string }
    expect(bodyJson.error).toBe('unsupported_locale')
    const all = await getDb().select({ id: recipe.id }).from(recipe)
    expect(all.length).toBe(0)
  })

  it('#272: robots.txt do site proíbe → 403 {robots_blocked}, ZERO efeito (não importa)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'import-robots@ex.com' })
    await seedAllowlist()
    setRecipeImporter(new FakeRecipeImporter(undefined, 'robots_blocked'))

    const res = await importPost({ url: SRC }, headers)
    expect(res.status).toBe(403) // política do site externo (não 422) — distinto do 403 do SSRF guard
    const bodyJson = (await res.json()) as { error: string }
    expect(bodyJson.error).toBe('robots_blocked')
    const all = await getDb().select({ id: recipe.id }).from(recipe)
    expect(all.length).toBe(0)
  })

  it('url ausente/malformada → 400 (antes do seam)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'import-badurl@ex.com' })
    // Importer que estouraria se chamado — prova que o 400 acontece ANTES do seam.
    setRecipeImporter(new FakeRecipeImporter())

    expect((await importPost({}, headers)).status).toBe(400)
    expect((await importPost({ url: 'javascript:alert(1)' }, headers)).status).toBe(400)
    expect((await importPost({ url: 'não é url' }, headers)).status).toBe(400)
    const all = await getDb().select({ id: recipe.id }).from(recipe)
    expect(all.length).toBe(0)
  })

  it('SSRF guard (#164): domínio FORA da allowlist → 403, ZERO efeito (antes do seam)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'import-ssrf@ex.com' })
    await seedAllowlist(['exemplo.com']) // só exemplo.com liberado
    // Importer que estouraria se chamado — prova que o 403 acontece ANTES do seam (sem fetch).
    setRecipeImporter(new FakeRecipeImporter())

    // Host fora da curadoria: recusado com 403, sem importar.
    const res = await importPost({ url: 'https://evil.test/receita' }, headers)
    expect(res.status).toBe(403)
    const bodyJson = (await res.json()) as { error: string }
    expect(bodyJson.error).toBe('dominio_nao_permitido')

    // Subdomínio do allowlistado PASSA o guard (vai ao seam → 201).
    const ok = await importPost({ url: 'https://m.exemplo.com/receita' }, headers)
    expect(ok.status).toBe(201)
  })

  it('SSRF guard (#164): allowlist VAZIA recusa TODA URL (fail-closed) → 403', async () => {
    const { headers } = await seedSessionHeaders({ email: 'import-emptyallow@ex.com' })
    // SEM seedAllowlist: app_config nasce vazia (allowlist []), fail-closed.
    setRecipeImporter(new FakeRecipeImporter())

    const res = await importPost({ url: SRC }, headers)
    expect(res.status).toBe(403)
    const all = await getDb().select({ id: recipe.id }).from(recipe)
    expect(all.length).toBe(0)
  })
})
