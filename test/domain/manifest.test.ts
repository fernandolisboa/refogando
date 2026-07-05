import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import manifest from '@/app/manifest'

/**
 * Manifest PWA (#456, segue #270): `src/app/manifest.ts` é uma Metadata Route PURA do Next
 * (sem I/O/DB), então dá pra chamar o default export direto — sem precisar de servidor/build.
 * Cobre a installability mínima (ícones 192/512 + maskable, start_url, display standalone) e
 * TRAVA a landmine de marca (regra enfática do dono): o texto voltado ao usuário nunca pode
 * descrever o app como "bilíngue" nem enumerar idiomas (ex.: "pt-BR"/"en-US").
 */
describe('manifest — installability + landmine de marca', () => {
  const m = manifest()

  it('nome e descrição não mencionam "bilíngue" nem enumeram idiomas', () => {
    const texto = `${m.name} ${m.short_name} ${m.description}`.toLowerCase()
    expect(texto).not.toContain('bilíngue')
    expect(texto).not.toContain('bilingual')
    expect(texto).not.toMatch(/pt-br|en-us/)
    expect(m.description).toBe('App de receitas com IA.')
  })

  it('é instalável como app standalone a partir da raiz', () => {
    expect(m.start_url).toBe('/')
    expect(m.display).toBe('standalone')
  })

  it('tem tema/fundo coerentes com a marca (creme)', () => {
    expect(m.theme_color).toBe('#FBF7EF')
    expect(m.background_color).toBe('#FBF7EF')
  })

  it('tem ícones 192x192 e 512x512, incluindo variante maskable', () => {
    const icons = m.icons ?? []
    const has = (sizes: string, purpose?: string) =>
      icons.some((i) => i.sizes === sizes && (purpose ? i.purpose === purpose : true))

    expect(has('192x192', 'any')).toBe(true)
    expect(has('512x512', 'any')).toBe(true)
    expect(has('512x512', 'maskable')).toBe(true)
    for (const icon of icons) {
      expect(icon.type).toBe('image/png')
    }
  })

  it('os arquivos de ícone referenciados existem de fato em public/ (não só o manifest aponta pra eles)', () => {
    const icons = m.icons ?? []
    expect(icons.length).toBeGreaterThan(0)
    for (const icon of icons) {
      const src = typeof icon.src === 'string' ? icon.src : ''
      expect(src).toMatch(/^\/icon-(192|512)\.png$/)
      const abs = path.join(process.cwd(), 'public', src)
      expect(existsSync(abs)).toBe(true)
    }
  })
})
