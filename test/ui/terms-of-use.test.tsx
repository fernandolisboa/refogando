import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Teste jsdom (sem DB) dos Termos de Uso v1 PUBLICADOS (ADR-0051). Cobre:
 *  - render bilíngue: `<h1>`, as 11 seções em `<h2>`, na ordem, e todo parágrafo/item/linha do histórico;
 *  - PUBLICAÇÃO: nenhuma chave crua (`{`/`}`), o e-mail real do canal, a idade mínima, e nada de "advogado"
 *    (o sign-off é interno, nunca alegar advogado);
 *  - os destaques do CDC art. 54 (negrito) nas cláusulas certas e só nelas;
 *  - rodapé igual à última linha do histórico, e a data de cada versão (`DATA_PUBLICACAO_TERMOS_V1`, `DATA_TERMOS_V1_1`, `DATA_TERMOS_V1_2`);
 *  - paridade de chaves e de tamanho dos arrays pt-BR/en-US;
 *  - o link do rodapé do site e o `generateMetadata` da página.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/pt-BR',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import { TermsOfUse } from '@/components/legal/terms-of-use'
import { SiteFooter } from '@/components/site-footer'
import { generateMetadata } from '@/app/[locale]/(com-carregamento)/termos/page'
import { DATA_PUBLICACAO_TERMOS_V1, DATA_TERMOS_V1_1, DATA_TERMOS_V1_2 } from '@/domain/legal-notice'

function renderAt(locale: 'pt-BR' | 'en-US') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <TermsOfUse />
    </LocaleProvider>,
  )
}

type Termos = Record<string, unknown>

/** As chaves `sNTitulo` da seção, em ordem numérica. */
function titulosEmOrdem(m: Termos): { n: number; titulo: string }[] {
  return Object.keys(m)
    .map((k) => /^s(\d+)Titulo$/.exec(k))
    .filter((x): x is RegExpExecArray => x !== null)
    .map((x) => ({ n: Number(x[1]), titulo: m[x[0]] as string }))
    .sort((a, b) => a.n - b.n)
}

/** Todo texto que vira parágrafo ou item: `sNCorpo`, `s7Itens`, `s10Historico`. */
function textosDoCorpo(m: Termos): string[] {
  return Object.entries(m)
    .filter(([k]) => /^s\d+(Corpo|Itens|Historico)$/.test(k))
    .flatMap(([, v]) => v as string[])
}

describe('TermsOfUse (ADR-0051 — Termos de Uso v1)', () => {
  for (const [locale, msgs] of [
    ['pt-BR', ptBR],
    ['en-US', enUS],
  ] as const) {
    it(`${locale}: h1, as 11 seções em h2 na ordem e todo o texto`, () => {
      renderAt(locale)
      const m = msgs.termos as unknown as Termos
      expect(screen.getByRole('heading', { level: 1, name: msgs.termos.titulo })).toBeInTheDocument()
      expect(screen.getByText(msgs.termos.intro)).toBeInTheDocument()

      const titulos = titulosEmOrdem(m)
      expect(titulos.map((t) => t.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
      for (const { n, titulo } of titulos) expect(titulo.startsWith(`${n}.`)).toBe(true)
      // Todas em <h2>, na ordem do documento.
      const h2 = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
      expect(h2).toEqual(titulos.map((t) => t.titulo))

      for (const texto of textosDoCorpo(m)) expect(screen.getByText(texto)).toBeInTheDocument()
    })
  }

  it('en-US não traz o texto pt-BR', () => {
    renderAt('en-US')
    expect(screen.queryByText(ptBR.termos.titulo)).not.toBeInTheDocument()
    expect(screen.queryByText(ptBR.termos.s2Corpo[0])).not.toBeInTheDocument()
  })

  it('PUBLICADOS: sem chaves cruas, com o canal real e a idade mínima, sem alegar advogado', () => {
    const { container } = renderAt('pt-BR')
    const text = container.textContent ?? ''
    expect(text).not.toContain('{')
    expect(text).not.toContain('}')
    expect(text).toContain('privacidade@refogando.com')
    expect(text).toContain('16 anos ou mais')
    expect(text.toLowerCase()).not.toContain('advogad')
    expect((renderAt('en-US').container.textContent ?? '').toLowerCase()).not.toContain('lawyer')
  })

  it('destaques do CDC art. 54 (negrito) só nas cláusulas escolhidas', () => {
    const { container } = renderAt('pt-BR')
    const m = ptBR.termos
    const destacados = [
      m.s4Corpo[0],
      m.s5Corpo[2],
      m.s5Corpo[3],
      m.s5Corpo[4],
      m.s8Corpo[3],
      m.s9Corpo[0],
      m.s9Corpo[1],
      m.s10Corpo[0],
    ]
    for (const texto of destacados) expect(screen.getByText(texto)).toHaveClass('font-semibold')
    // Só esses: os outros parágrafos do corpo seguem no peso normal.
    expect(container.querySelectorAll('main p.font-semibold')).toHaveLength(destacados.length)
    expect(screen.getByText(m.s5Corpo[0])).not.toHaveClass('font-semibold')
  })

  it('rodapé repete a última linha do histórico; cada versão com a sua data (v1 congelada, v1.1 do #605, v1.2 do #599)', () => {
    for (const msgs of [ptBR, enUS]) {
      const m = msgs.termos
      const ultima = m.s10Historico[m.s10Historico.length - 1]
      expect(ultima.startsWith(`${m.rodapeVersao} — ${m.rodapeData}`)).toBe(true)
      expect(m.s10Historico[0].startsWith(`v1 — ${DATA_PUBLICACAO_TERMOS_V1}`)).toBe(true)
      expect(m.s10Historico[1].startsWith(`v1.1 — ${DATA_TERMOS_V1_1}`)).toBe(true)
      expect(m.rodapeData).toBe(DATA_TERMOS_V1_2)
    }
    // Cada data de versão no formato AAAA-MM-DD (o dia do merge em UTC).
    for (const data of [DATA_PUBLICACAO_TERMOS_V1, DATA_TERMOS_V1_1, DATA_TERMOS_V1_2]) expect(data).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // #605: o item 8 cita a receita pública no botão Reportar e mantém o e-mail como via (nada retirado).
    expect(ptBR.termos.s8Corpo[0]).toContain('receita pública ou uma avaliação pelo botão Reportar')
    expect(ptBR.termos.s8Corpo[0]).toContain('privacidade@refogando.com')
    expect(enUS.termos.s8Corpo[0]).toContain('public recipe or a review with the Report button')
    renderAt('pt-BR')
    // Match exato: distinto da linha do histórico.
    expect(screen.getByText(ptBR.termos.rodapeVersao)).toBeInTheDocument()
  })

  it('paridade pt-BR/en-US: mesmas chaves e arrays do mesmo tamanho', () => {
    const pt = ptBR.termos as unknown as Termos
    const en = enUS.termos as unknown as Termos
    expect(Object.keys(en).sort()).toEqual(Object.keys(pt).sort())
    for (const key of Object.keys(pt)) {
      const pv = pt[key]
      if (Array.isArray(pv)) {
        expect(Array.isArray(en[key]), `en-US.${key} deve ser array`).toBe(true)
        expect((en[key] as unknown[]).length, `comprimento de ${key}`).toBe(pv.length)
      }
    }
  })

  for (const [locale, msgs] of [
    ['pt-BR', ptBR],
    ['en-US', enUS],
  ] as const) {
    it(`${locale}: o rodapé do site linka os Termos em /termos`, () => {
      render(
        <LocaleProvider initialLocale={locale}>
          <SiteFooter />
        </LocaleProvider>,
      )
      const link = within(screen.getByRole('contentinfo')).getByRole('link', { name: msgs.termos.nome })
      expect(link).toHaveAttribute('href', '/termos')
    })

    it(`${locale}: generateMetadata dá o título da página`, async () => {
      await expect(generateMetadata({ params: Promise.resolve({ locale }) })).resolves.toEqual({
        title: msgs.termos.metaTitulo,
      })
    })
  }
})
