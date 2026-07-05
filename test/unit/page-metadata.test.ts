import { describe, it, expect } from 'vitest'
import { loggedInPageMetadata, publicPageMetadata } from '@/server/http/page-metadata'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'

/**
 * #462: helpers de `generateMetadata` — título fino localizado pelo SEGMENTO da URL (ADR-0020),
 * reusando strings i18n existentes. `loggedIn*` acrescenta noindex (superfície só-logada); `public*`
 * só o título (indexável). Sem DB/jsdom — funções puras sobre `params`.
 */
describe('page-metadata helpers (#462)', () => {
  const params = (locale: string) => Promise.resolve({ locale })

  it('loggedInPageMetadata: título no locale do path + robots noindex', async () => {
    const meta = await loggedInPageMetadata(params('pt-BR'), (m) => m.minhasCriacoes.titulo)
    expect(meta.title).toBe(ptBR.minhasCriacoes.titulo)
    expect(meta.robots).toEqual({ index: false, follow: false })
  })

  it('loggedInPageMetadata: respeita o locale en-US do path', async () => {
    const meta = await loggedInPageMetadata(params('en-US'), (m) => m.admin.navIa)
    expect(meta.title).toBe(enUS.admin.navIa)
    expect(meta.robots).toEqual({ index: false, follow: false })
  })

  it('publicPageMetadata: só título (sem noindex — página pública)', async () => {
    const meta = await publicPageMetadata(params('pt-BR'), (m) => m.nav.signIn)
    expect(meta.title).toBe(ptBR.nav.signIn)
    expect(meta.robots).toBeUndefined()
  })

  it('locale inválido no path degrada pro default (pt-BR) sem quebrar', async () => {
    const meta = await loggedInPageMetadata(params('xx-YY'), (m) => m.criar.titulo)
    expect(meta.title).toBe(ptBR.criar.titulo)
  })
})
