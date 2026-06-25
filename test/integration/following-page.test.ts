import { describe, expect, it } from 'vitest'
import { generateMetadata } from '@/app/[locale]/following/page'

/**
 * Página Seguindo (#277, AC3) — metadados. A superfície é SÓ-LOGADA e personalizada, então NÃO pode
 * ser indexada: `generateMetadata` emite `robots: { index:false, follow:false }`. Sem DB (só lê o
 * catálogo de mensagens pelo locale do path). Espelha o padrão `robotsOf` de `home-feed.test.ts`.
 */
function robotsOf(meta: Awaited<ReturnType<typeof generateMetadata>>) {
  const r = meta.robots
  return typeof r === 'object' && r != null ? r : {}
}

describe('Página Seguindo — NÃO-indexável (#277, AC3)', () => {
  it('generateMetadata ⇒ robots noindex/nofollow', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ locale: 'pt-BR' }) })
    const robots = robotsOf(meta)
    expect(robots.index).toBe(false)
    expect(robots.follow).toBe(false)
  })

  it('título vem do catálogo do locale do PATH (URL é a verdade do idioma, ADR-0020)', async () => {
    const pt = await generateMetadata({ params: Promise.resolve({ locale: 'pt-BR' }) })
    const en = await generateMetadata({ params: Promise.resolve({ locale: 'en-US' }) })
    expect(pt.title).toBe('Seguindo')
    expect(en.title).toBe('Following')
  })
})
