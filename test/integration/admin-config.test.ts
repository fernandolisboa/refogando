import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { GET, PUT } from '@/app/api/admin/config/route'
import { getDb } from '@/server/deps'
import { loadAppConfig } from '@/server/app-config'
import { seedSessionHeaders } from '../helpers/users'
import { DEFAULT_IMAGE_MODEL, type ImageGenConfig } from '@/domain/image-gen-config'
import { type RecipeGenCapByRole } from '@/domain/recipe-gen-config'
import { DEFAULT_POPULARITY_CONFIG, type PopularityConfig } from '@/domain/popularity'

/**
 * Config de app — GET/PUT admin-only (T8, #5.AC2; #134). Prova: Usuário e Curador negados (403);
 * Admin lê/grava; PUT fora da allowlist → 400; round-trip no singleton app_config. #134: GET inclui
 * `imageGen { enabled, model, dailyCapByRole }` (defaults em código); PUT valida/persiste `imageGen`
 * em separado do `defaultModel` (cada eixo atualizável sozinho); `imageGen` inválido → 400.
 */

function get(headers?: Headers): Promise<Response> {
  return GET(new Request('http://localhost/api/admin/config', { headers }))
}
function put(body: unknown, headers?: Headers): Promise<Response> {
  return PUT(
    new Request('http://localhost/api/admin/config', {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

describe('/api/admin/config — modelo default (admin-only)', () => {
  it('Usuário → 403 em GET e PUT', async () => {
    const { headers } = await seedSessionHeaders({ email: 'user@cfg.test', role: 'usuario' })
    expect((await get(headers)).status).toBe(403)
    expect((await put({ defaultModel: 'claude-sonnet-4-6' }, headers)).status).toBe(403)
  })

  it('Curador → 403 em GET e PUT', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cur@cfg.test', role: 'curador' })
    expect((await get(headers)).status).toBe(403)
    expect((await put({ defaultModel: 'claude-sonnet-4-6' }, headers)).status).toBe(403)
  })

  it('sem sessão → 401 em GET', async () => {
    const res = await get()
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
  })

  it('Admin → 200 no GET; default em código quando a linha está ausente', async () => {
    const { headers } = await seedSessionHeaders({ email: 'admin@cfg.test', role: 'admin' })
    const res = await get(headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ defaultModel: 'claude-opus-4-8' })
  })

  it('Admin PUT fora da allowlist → 400 modelo_invalido', async () => {
    const { headers } = await seedSessionHeaders({ email: 'admin2@cfg.test', role: 'admin' })
    const res = await put({ defaultModel: 'gpt-4' }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'modelo_invalido' })
  })

  it('Admin PUT sem defaultModel string → 400 modelo_invalido', async () => {
    const { headers } = await seedSessionHeaders({ email: 'admin3@cfg.test', role: 'admin' })
    expect((await put({}, headers)).status).toBe(400)
    expect((await put({ defaultModel: 123 }, headers)).status).toBe(400)
  })

  it('Admin PUT válido persiste e um GET subsequente relê o novo valor', async () => {
    const { headers } = await seedSessionHeaders({ email: 'admin4@cfg.test', role: 'admin' })

    const putRes = await put({ defaultModel: 'claude-sonnet-4-6' }, headers)
    expect(putRes.status).toBe(200)
    await expect(putRes.json()).resolves.toMatchObject({ defaultModel: 'claude-sonnet-4-6' })

    // Round-trip: nova Request de GET relê o singleton persistido.
    const getRes = await get(headers)
    expect(getRes.status).toBe(200)
    await expect(getRes.json()).resolves.toMatchObject({ defaultModel: 'claude-sonnet-4-6' })
  })
})

// ── #134: imageGen { enabled, model, dailyCapByRole } ────────────────────────────
describe('/api/admin/config — imageGen (#134, admin-only)', () => {
  const okImageGen: ImageGenConfig = {
    enabled: false,
    model: DEFAULT_IMAGE_MODEL,
    dailyCapByRole: { usuario: 1, curador: 2, admin: null },
  }

  it('GET traz imageGen com defaults em código quando a linha está ausente', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ig-get@cfg.test', role: 'admin' })
    const body = (await (await get(headers)).json()) as { imageGen: ImageGenConfig }
    expect(body.imageGen).toEqual({
      enabled: true,
      model: DEFAULT_IMAGE_MODEL,
      dailyCapByRole: { usuario: 3, curador: 5, admin: null },
    })
  })

  it('PUT imageGen válido persiste e GET relê (round-trip) — sem afetar defaultModel', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ig-put@cfg.test', role: 'admin' })
    const putRes = await put({ imageGen: okImageGen }, headers)
    expect(putRes.status).toBe(200)
    const putBody = (await putRes.json()) as { defaultModel: string; imageGen: ImageGenConfig }
    expect(putBody.imageGen).toEqual(okImageGen)
    expect(putBody.defaultModel).toBe('claude-opus-4-8') // eixo de chat preservado (default)

    const getBody = (await (await get(headers)).json()) as { imageGen: ImageGenConfig }
    expect(getBody.imageGen).toEqual(okImageGen)
  })

  it('PUT atualiza os DOIS eixos em separado sem um zerar o outro', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ig-both@cfg.test', role: 'admin' })
    // 1º grava só o defaultModel.
    expect((await put({ defaultModel: 'claude-sonnet-4-6' }, headers)).status).toBe(200)
    // 2º grava só o imageGen — NÃO pode reverter o defaultModel ao default.
    expect((await put({ imageGen: okImageGen }, headers)).status).toBe(200)
    const body = (await (await get(headers)).json()) as { defaultModel: string; imageGen: ImageGenConfig }
    expect(body.defaultModel).toBe('claude-sonnet-4-6')
    expect(body.imageGen).toEqual(okImageGen)
  })

  it('PUT imageGen inválido → 400 config_invalida (modelo fora da allowlist, teto negativo, papel faltante)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ig-bad@cfg.test', role: 'admin' })
    const badModel = await put({ imageGen: { ...okImageGen, model: 'gpt-image-1' } }, headers)
    expect(badModel.status).toBe(400)
    await expect(badModel.json()).resolves.toMatchObject({ error: 'config_invalida' })

    expect((await put({ imageGen: { ...okImageGen, dailyCapByRole: { usuario: -1, curador: 2, admin: null } } }, headers)).status).toBe(400)
    expect((await put({ imageGen: { ...okImageGen, dailyCapByRole: { usuario: 1, curador: 2 } } }, headers)).status).toBe(400)
    expect((await put({ imageGen: { ...okImageGen, enabled: 'sim' } }, headers)).status).toBe(400)
  })

  it('PUT corpo vazio (nenhum eixo) → 400', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ig-empty@cfg.test', role: 'admin' })
    expect((await put({}, headers)).status).toBe(400)
  })

  it('imageGen PUT é admin-only: Curador → 403', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ig-cur@cfg.test', role: 'curador' })
    expect((await put({ imageGen: okImageGen }, headers)).status).toBe(403)
  })
})

// ── #167: recipeGenCapByRole (teto de geração de receita por papel) ───────────────
describe('/api/admin/config — recipeGenCapByRole (#167, admin-only)', () => {
  const okCaps: RecipeGenCapByRole = { usuario: 5, curador: 12, admin: null }

  it('GET traz recipeGenCapByRole com defaults em código quando a linha está ausente', async () => {
    const { headers } = await seedSessionHeaders({ email: 'rg-get@cfg.test', role: 'admin' })
    const body = (await (await get(headers)).json()) as { recipeGenCapByRole: RecipeGenCapByRole }
    expect(body.recipeGenCapByRole).toEqual({ usuario: 10, curador: 20, admin: null })
  })

  it('PUT recipeGenCapByRole válido persiste e GET relê (round-trip)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'rg-put@cfg.test', role: 'admin' })
    const putRes = await put({ recipeGenCapByRole: okCaps }, headers)
    expect(putRes.status).toBe(200)
    const putBody = (await putRes.json()) as { recipeGenCapByRole: RecipeGenCapByRole }
    expect(putBody.recipeGenCapByRole).toEqual(okCaps)

    const getBody = (await (await get(headers)).json()) as { recipeGenCapByRole: RecipeGenCapByRole }
    expect(getBody.recipeGenCapByRole).toEqual(okCaps)
  })

  it('PUT recipeGenCapByRole NÃO zera os outros eixos (defaultModel/imageGen preservados)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'rg-iso@cfg.test', role: 'admin' })
    // 1º grava o defaultModel; 2º grava só o teto de receita — o modelo de chat não pode reverter.
    expect((await put({ defaultModel: 'claude-sonnet-4-6' }, headers)).status).toBe(200)
    expect((await put({ recipeGenCapByRole: okCaps }, headers)).status).toBe(200)
    const body = (await (await get(headers)).json()) as {
      defaultModel: string
      recipeGenCapByRole: RecipeGenCapByRole
    }
    expect(body.defaultModel).toBe('claude-sonnet-4-6')
    expect(body.recipeGenCapByRole).toEqual(okCaps)
  })

  it('teto 0 é válido (zera o papel)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'rg-zero@cfg.test', role: 'admin' })
    const res = await put({ recipeGenCapByRole: { usuario: 0, curador: 12, admin: null } }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      recipeGenCapByRole: { usuario: 0, curador: 12, admin: null },
    })
  })

  it('PUT recipeGenCapByRole inválido → 400 config_invalida (negativo, float, papel faltante, chave estranha)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'rg-bad@cfg.test', role: 'admin' })
    expect((await put({ recipeGenCapByRole: { usuario: -1, curador: 12, admin: null } }, headers)).status).toBe(400)
    expect((await put({ recipeGenCapByRole: { usuario: 2.5, curador: 12, admin: null } }, headers)).status).toBe(400)
    expect((await put({ recipeGenCapByRole: { usuario: 5, curador: 12 } }, headers)).status).toBe(400)
    const bad = await put({ recipeGenCapByRole: { usuario: 5, curador: 12, admin: null, root: 9 } }, headers)
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({ error: 'config_invalida' })
  })

  it('recipeGenCapByRole PUT é admin-only: Curador → 403', async () => {
    const { headers } = await seedSessionHeaders({ email: 'rg-cur@cfg.test', role: 'curador' })
    expect((await put({ recipeGenCapByRole: okCaps }, headers)).status).toBe(403)
  })
})

// ── #164: webSearch { enabled, allowlist } (descoberta na web, ADR-0019) ──────────
describe('/api/admin/config — webSearch (#164, admin-only)', () => {
  it('GET traz webSearch com default DESLIGADO + allowlist vazia quando a linha está ausente', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ws-get@cfg.test', role: 'admin' })
    const body = (await (await get(headers)).json()) as {
      webSearch: { enabled: boolean; allowlist: string[] }
    }
    expect(body.webSearch).toEqual({ enabled: false, allowlist: [] })
  })

  it('PUT webSearch válido persiste (allowlist CANONICALIZADA) e GET relê (round-trip)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ws-put@cfg.test', role: 'admin' })
    const putRes = await put(
      { webSearch: { enabled: true, allowlist: ['WWW.TudoGostoso.com.br', 'cybercook.com.br'] } },
      headers,
    )
    expect(putRes.status).toBe(200)
    const putBody = (await putRes.json()) as { webSearch: { enabled: boolean; allowlist: string[] } }
    expect(putBody.webSearch).toEqual({
      enabled: true,
      allowlist: ['tudogostoso.com.br', 'cybercook.com.br'], // minúsculo, sem www.
    })

    const getBody = (await (await get(headers)).json()) as {
      webSearch: { enabled: boolean; allowlist: string[] }
    }
    expect(getBody.webSearch.enabled).toBe(true)
    expect(getBody.webSearch.allowlist).toEqual(['tudogostoso.com.br', 'cybercook.com.br'])
  })

  it('PUT webSearch NÃO zera os outros eixos (defaultModel preservado)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ws-iso@cfg.test', role: 'admin' })
    expect((await put({ defaultModel: 'claude-sonnet-4-6' }, headers)).status).toBe(200)
    expect((await put({ webSearch: { enabled: true, allowlist: ['a.com'] } }, headers)).status).toBe(200)
    const body = (await (await get(headers)).json()) as {
      defaultModel: string
      webSearch: { enabled: boolean; allowlist: string[] }
    }
    expect(body.defaultModel).toBe('claude-sonnet-4-6')
    expect(body.webSearch).toEqual({ enabled: true, allowlist: ['a.com'] })
  })

  it('PUT webSearch inválido → 400 config_invalida (domínio malformado, enabled não-bool)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ws-bad@cfg.test', role: 'admin' })
    expect((await put({ webSearch: { enabled: true, allowlist: ['localhost'] } }, headers)).status).toBe(400)
    expect((await put({ webSearch: { enabled: true, allowlist: ['https://a.com'] } }, headers)).status).toBe(400)
    const bad = await put({ webSearch: { enabled: 'sim', allowlist: [] } }, headers)
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({ error: 'config_invalida' })
  })

  it('PUT webSearch com domínio vetado por ToS (#394) → 400 dominio_vetado (host exato e subdomínio)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ws-deny@cfg.test', role: 'admin' })
    // host exato vetado no lote (junto de um domínio limpo) ⇒ rejeita o lote inteiro com motivo claro
    const exact = await put(
      { webSearch: { enabled: true, allowlist: ['tudogostoso.com.br', 'panelinha.com.br'] } },
      headers,
    )
    expect(exact.status).toBe(400)
    await expect(exact.json()).resolves.toMatchObject({
      error: 'dominio_vetado',
      domains: ['panelinha.com.br'],
    })
    // subdomínio de um host vetado também é barrado
    const sub = await put(
      { webSearch: { enabled: true, allowlist: ['m.foodnetwork.com'] } },
      headers,
    )
    expect(sub.status).toBe(400)
    await expect(sub.json()).resolves.toMatchObject({ error: 'dominio_vetado' })
    // e a config NÃO foi persistida (o eixo continua no default vazio/desligado)
    const body = (await (await get(headers)).json()) as {
      webSearch: { enabled: boolean; allowlist: string[] }
    }
    expect(body.webSearch).toEqual({ enabled: false, allowlist: [] })
  })

  it('webSearch PUT é admin-only: Curador → 403', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ws-cur@cfg.test', role: 'curador' })
    expect((await put({ webSearch: { enabled: true, allowlist: ['a.com'] } }, headers)).status).toBe(403)
  })
})

// ── #237: catalogDisclosure { enabled, text } (aviso de catálogo AI-assistido, SEO #187) ──────────
describe('/api/admin/config — catalogDisclosure (#237, admin-only)', () => {
  it('GET traz catalogDisclosure com default DESLIGADO + texto padrão quando a linha está ausente', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cd-get@cfg.test', role: 'admin' })
    const body = (await (await get(headers)).json()) as {
      catalogDisclosure: { enabled: boolean; text: string }
    }
    expect(body.catalogDisclosure.enabled).toBe(false)
    expect(body.catalogDisclosure.text.length).toBeGreaterThan(0)
  })

  it('PUT catalogDisclosure válido persiste (texto TRIMADO) e GET relê (round-trip)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cd-put@cfg.test', role: 'admin' })
    const putRes = await put(
      { catalogDisclosure: { enabled: true, text: '  Curadoria + IA.  ' } },
      headers,
    )
    expect(putRes.status).toBe(200)
    const putBody = (await putRes.json()) as { catalogDisclosure: { enabled: boolean; text: string } }
    expect(putBody.catalogDisclosure).toEqual({ enabled: true, text: 'Curadoria + IA.' })

    const getBody = (await (await get(headers)).json()) as {
      catalogDisclosure: { enabled: boolean; text: string }
    }
    expect(getBody.catalogDisclosure).toEqual({ enabled: true, text: 'Curadoria + IA.' })
  })

  it('PUT catalogDisclosure NÃO zera os outros eixos (defaultModel preservado)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cd-iso@cfg.test', role: 'admin' })
    expect((await put({ defaultModel: 'claude-sonnet-4-6' }, headers)).status).toBe(200)
    expect(
      (await put({ catalogDisclosure: { enabled: true, text: 'Curadoria + IA.' } }, headers)).status,
    ).toBe(200)
    const body = (await (await get(headers)).json()) as {
      defaultModel: string
      catalogDisclosure: { enabled: boolean; text: string }
    }
    expect(body.defaultModel).toBe('claude-sonnet-4-6')
    expect(body.catalogDisclosure).toEqual({ enabled: true, text: 'Curadoria + IA.' })
  })

  it('PUT catalogDisclosure inválido → 400 config_invalida (texto vazio, enabled não-bool)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cd-bad@cfg.test', role: 'admin' })
    expect((await put({ catalogDisclosure: { enabled: true, text: '   ' } }, headers)).status).toBe(400)
    const bad = await put({ catalogDisclosure: { enabled: 'sim', text: 'x' } }, headers)
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({ error: 'config_invalida' })
  })

  it('catalogDisclosure PUT é admin-only: Curador → 403', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cd-cur@cfg.test', role: 'curador' })
    expect(
      (await put({ catalogDisclosure: { enabled: true, text: 'x' } }, headers)).status,
    ).toBe(403)
  })
})

// ── #368: popularity { wSave, wNota, wNovo, m, tauDays } (mistura de popularidade, ADR-0027/0028) ──
describe('/api/admin/config — popularity (#368, admin-only)', () => {
  const okPopularity: PopularityConfig = { wSave: 2, wNota: 1, wNovo: 0.25, m: 15, tauDays: 45 }

  it('GET traz popularity com o DEFAULT em código quando a linha está ausente', async () => {
    const { headers } = await seedSessionHeaders({ email: 'pop-get@cfg.test', role: 'admin' })
    const body = (await (await get(headers)).json()) as { popularity: PopularityConfig }
    expect(body.popularity).toEqual(DEFAULT_POPULARITY_CONFIG)
  })

  it('PUT popularity válido persiste e GET relê (round-trip) — sem afetar defaultModel', async () => {
    const { headers } = await seedSessionHeaders({ email: 'pop-put@cfg.test', role: 'admin' })
    const putRes = await put({ popularity: okPopularity }, headers)
    expect(putRes.status).toBe(200)
    const putBody = (await putRes.json()) as { defaultModel: string; popularity: PopularityConfig }
    expect(putBody.popularity).toEqual(okPopularity)
    expect(putBody.defaultModel).toBe('claude-opus-4-8') // eixo de chat preservado (default)
    const getBody = (await (await get(headers)).json()) as { popularity: PopularityConfig }
    expect(getBody.popularity).toEqual(okPopularity)
  })

  it('PUT popularity NÃO zera os outros eixos (defaultModel preservado)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'pop-iso@cfg.test', role: 'admin' })
    expect((await put({ defaultModel: 'claude-sonnet-4-6' }, headers)).status).toBe(200)
    expect((await put({ popularity: okPopularity }, headers)).status).toBe(200)
    const body = (await (await get(headers)).json()) as {
      defaultModel: string
      popularity: PopularityConfig
    }
    expect(body.defaultModel).toBe('claude-sonnet-4-6')
    expect(body.popularity).toEqual(okPopularity)
  })

  it('aceita peso 0 (desliga um termo)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'pop-zero@cfg.test', role: 'admin' })
    const res = await put({ popularity: { ...okPopularity, wNovo: 0 } }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      popularity: { ...okPopularity, wNovo: 0 },
    })
  })

  it('PUT popularity inválido → 400 config_invalida (Infinity, negativo, m<=0, tau<=0, campo faltando)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'pop-bad@cfg.test', role: 'admin' })
    expect((await put({ popularity: { ...okPopularity, wSave: Infinity } }, headers)).status).toBe(400)
    expect((await put({ popularity: { ...okPopularity, wNota: -1 } }, headers)).status).toBe(400)
    expect((await put({ popularity: { ...okPopularity, m: 0 } }, headers)).status).toBe(400)
    expect((await put({ popularity: { ...okPopularity, tauDays: -5 } }, headers)).status).toBe(400)
    const bad = await put({ popularity: { wSave: 1, wNota: 1, wNovo: 1, m: 20 } }, headers) // sem tauDays
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({ error: 'config_invalida' })
  })

  it('read-path FAIL-SAFE: jsonb corrompido cai no DEFAULT (não vaza config inválida pro ranking)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'pop-corrupt@cfg.test', role: 'admin' })
    // Grava uma config VÁLIDA (cria o singleton) e corrompe a coluna DIRETO no banco (burla o PUT:
    // simula uma linha legada/editada à mão com peso negativo + m<=0 — o parse deve rejeitar e cair no DEFAULT).
    expect((await put({ popularity: okPopularity }, headers)).status).toBe(200)
    await getDb().execute(
      sql`UPDATE app_config SET popularity_config = '{"wSave":-1,"wNota":1,"wNovo":0.5,"m":0,"tauDays":30}'::jsonb WHERE id = true`,
    )
    const cfg = await loadAppConfig(getDb())
    expect(cfg.popularity).toEqual(DEFAULT_POPULARITY_CONFIG)
  })

  it('popularity PUT é admin-only: Curador → 403', async () => {
    const { headers } = await seedSessionHeaders({ email: 'pop-cur@cfg.test', role: 'curador' })
    expect((await put({ popularity: okPopularity }, headers)).status).toBe(403)
  })
})
