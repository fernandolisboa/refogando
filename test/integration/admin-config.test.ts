import { describe, expect, it } from 'vitest'
import { GET, PUT } from '@/app/api/admin/config/route'
import { seedSessionHeaders } from '../helpers/users'
import { DEFAULT_IMAGE_MODEL, type ImageGenConfig } from '@/domain/image-gen-config'

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
