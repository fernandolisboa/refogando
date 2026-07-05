import { describe, it, expect } from 'vitest'
import { GET } from '@/app/api/discovery/web/route'
import { getDb, setWebSearchProvider } from '@/server/deps'
import {
  FakeWebSearchProvider,
  CANONICAL_WEB_RESULTS,
  type WebSearchResult,
} from '@/server/web-search/web-search-provider'
import { appConfig, webSearchUsageDaily } from '@/db/schema'
import { DAILY_WEB_SEARCH_QUERY_CAP, utcDayKey } from '@/domain/web-search-budget'

/**
 * Descoberta na WEB (#164, ADR-0019) pela porta MAIS ALTA (GET /api/discovery/web) com
 * `FakeWebSearchProvider` injetado (NUNCA toca a rede). `setup.ts` aponta o DI pro Postgres descartável
 * e reseta seams/trunca antes de cada teste — app_config nasce vazia (descoberta DESLIGADA por default).
 *
 * Cobre: LIGADA + allowlist → links externos; DESLIGADA → vazio; allowlist VAZIA → vazio (fail-closed);
 * termo vazio → vazio (sem tocar provedor); filtro de allowlist na SAÍDA (defesa em profundidade).
 */

const DOMAINS = ['tudogostoso.com.br', 'cybercook.com.br']

/** Liga a descoberta na web e define a allowlist no singleton app_config. */
async function seedWebSearch(enabled: boolean, allowlist: string[]): Promise<void> {
  await getDb()
    .insert(appConfig)
    .values({ id: true, webSearchEnabled: enabled, webSearchAllowlist: allowlist })
    .onConflictDoUpdate({
      target: appConfig.id,
      set: { webSearchEnabled: enabled, webSearchAllowlist: allowlist },
    })
}

function get(q: string, locale?: string, opts?: { ip?: string }): Promise<Response> {
  const url = new URL('http://localhost/api/discovery/web')
  if (q !== '') url.searchParams.set('q', q)
  if (locale) url.searchParams.set('locale', locale)
  const headers = opts?.ip ? { 'x-forwarded-for': opts.ip } : undefined
  return GET(new Request(url, { headers }))
}

async function results(res: Response): Promise<WebSearchResult[]> {
  const body = (await res.json()) as { results: WebSearchResult[] }
  return body.results
}

describe('GET /api/discovery/web (#164)', () => {
  it('LIGADA + allowlist: devolve links externos da web (FakeWebSearchProvider)', async () => {
    await seedWebSearch(true, DOMAINS)
    setWebSearchProvider(new FakeWebSearchProvider())

    const res = await get('feijoada')
    expect(res.status).toBe(200)
    const links = await results(res)
    expect(links.length).toBe(CANONICAL_WEB_RESULTS.length)
    // Cada link é externo, com title/url/sourceName (jamais conteúdo armazenado).
    for (const link of links) {
      expect(link.url).toMatch(/^https?:\/\//)
      expect(typeof link.title).toBe('string')
      expect(typeof link.sourceName).toBe('string')
    }
  })

  it('DESLIGADA: devolve vazio (não dispara o provedor)', async () => {
    await seedWebSearch(false, DOMAINS)
    // Provedor que estouraria se chamado — prova que NÃO é tocado quando desligado.
    setWebSearchProvider(
      new FakeWebSearchProvider([
        { title: 'x', url: 'https://tudogostoso.com.br/x', sourceName: 'X' },
      ]),
    )

    const res = await get('feijoada')
    expect(res.status).toBe(200)
    expect(await results(res)).toEqual([])
  })

  it('allowlist VAZIA: devolve vazio (fail-closed) mesmo ligada', async () => {
    await seedWebSearch(true, [])
    setWebSearchProvider(new FakeWebSearchProvider())

    const res = await get('feijoada')
    expect(res.status).toBe(200)
    expect(await results(res)).toEqual([])
  })

  it('sem config (app_config vazia): default DESLIGADO → vazio', async () => {
    // SEM seed: app_config nasce vazia → DEFAULT_WEB_SEARCH_CONFIG (desligado, allowlist []).
    setWebSearchProvider(new FakeWebSearchProvider())
    const res = await get('feijoada')
    expect(res.status).toBe(200)
    expect(await results(res)).toEqual([])
  })

  it('termo vazio: devolve vazio (estado neutro, sem tocar o provedor)', async () => {
    await seedWebSearch(true, DOMAINS)
    setWebSearchProvider(new FakeWebSearchProvider())
    const res = await get('')
    expect(res.status).toBe(200)
    expect(await results(res)).toEqual([])
  })

  it('defesa em profundidade: link cujo host saiu da allowlist é FILTRADO na saída', async () => {
    // Allowlist só com cybercook; o provedor (enlatado) tenta colar um link de domínio NÃO listado.
    await seedWebSearch(true, ['cybercook.com.br'])
    setWebSearchProvider(
      new FakeWebSearchProvider([
        { title: 'Bom', url: 'https://cybercook.com.br/r/1', sourceName: 'CyberCook' },
        { title: 'Fora', url: 'https://evil.test/r/2', sourceName: 'Evil' },
      ]),
    )

    const res = await get('feijoada')
    const links = await results(res)
    // O Fake já filtra pela allowlist; o endpoint re-filtra (defesa dupla). Só o host listado sobra.
    expect(links.map((l) => l.url)).toEqual(['https://cybercook.com.br/r/1'])
  })

  // ── Teto de GASTO diário (#464) ────────────────────────────────────────────────
  it('teto diário estourado ⇒ vazio (degrada, não erro) e NÃO toca o provedor', async () => {
    await seedWebSearch(true, DOMAINS)
    // Provedor que estouraria se chamado — prova que o teto barra ANTES da chamada paga.
    setWebSearchProvider(
      new FakeWebSearchProvider([
        { title: 'x', url: 'https://tudogostoso.com.br/x', sourceName: 'X' },
      ]),
    )
    // Contador do dia (UTC) já no teto ⇒ qualquer reserva falha.
    await getDb()
      .insert(webSearchUsageDaily)
      .values({ day: utcDayKey(new Date()), queryCount: DAILY_WEB_SEARCH_QUERY_CAP })

    const res = await get('feijoada')
    expect(res.status).toBe(200)
    expect(await results(res)).toEqual([])
  })

  it('teto diário: chamada bem-sucedida ACUMULA o contador (uma consulta por domínio da allowlist)', async () => {
    await seedWebSearch(true, DOMAINS)
    setWebSearchProvider(new FakeWebSearchProvider())

    expect((await get('feijoada')).status).toBe(200)
    const [row] = await getDb()
      .select({ n: webSearchUsageDaily.queryCount })
      .from(webSearchUsageDaily)
    // Duas entradas na allowlist ⇒ o provedor dispara 2 consultas ⇒ o contador sobe 2.
    expect(row?.n).toBe(DOMAINS.length)
  })

  // ── Rate-limit por IP (#464) ───────────────────────────────────────────────────
  it('rate-limit por IP: 2ª chamada rápida do MESMO IP degrada para vazio', async () => {
    await seedWebSearch(true, DOMAINS)
    setWebSearchProvider(new FakeWebSearchProvider())

    const ip = '203.0.113.42' // IP único deste teste (o limiter é módulo-escopo, best-effort in-memory)
    const first = await get('feijoada', undefined, { ip })
    expect((await results(first)).length).toBeGreaterThan(0)
    // Segunda dentro da janela (~1s) ⇒ barrada ⇒ vazio, sem tocar provedor/DB.
    const second = await get('feijoada', undefined, { ip })
    expect(await results(second)).toEqual([])
  })
})
