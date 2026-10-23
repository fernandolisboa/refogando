import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

/**
 * Teste jsdom (sem DB) da página de Política de Privacidade PUBLICADA (#398 / parte de #276; v3, revisada
 * no parecer interno de 2026-10-22). Cobre:
 *  - render bilíngue das DUAS partes (Parte a + Parte b);
 *  - a estrutura da v3: itens 3.1 a 3.9, seção 8 (cookies, com tabela), seção 9 (alterações + histórico
 *    de versões), 11 direitos e as tabelas de prestadores e de cookies com colunas do mesmo tamanho;
 *  - PUBLICAÇÃO: nenhum placeholder/`[validar]` sobra no render (zero `[data-todo]`, zero `{`/`}`),
 *    e o e-mail real do canal (privacidade@refogando.com) aparece;
 *  - rodapé de status/versão, igual à última linha do histórico;
 *  - paridade de comprimento das listas pt-BR/en-US da seção (rede de segurança do teste node de paridade).
 */
import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import { PrivacyPolicy } from '@/components/legal/privacy-policy'

function renderAt(locale: 'pt-BR' | 'en-US') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <PrivacyPolicy />
    </LocaleProvider>,
  )
}

describe('PrivacyPolicy (#398 — página gated de Política de Privacidade)', () => {
  it('pt-BR: renderiza as duas partes e o rodapé de status da revisão', () => {
    renderAt('pt-BR')
    expect(screen.getByRole('heading', { level: 1, name: ptBR.privacidade.titulo })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: ptBR.privacidade.parteATitulo })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: ptBR.privacidade.parteBTitulo })).toBeInTheDocument()
    // Rodapé de versão/data/status (AC #4).
    expect(screen.getByText(ptBR.privacidade.rodapeStatus)).toBeInTheDocument()
    expect(screen.getByText(ptBR.privacidade.rodapeVersao)).toBeInTheDocument()
  })

  it('en-US: renderiza no idioma correto (i18n de verdade, sem string pt hardcoded)', () => {
    renderAt('en-US')
    expect(screen.getByRole('heading', { level: 1, name: enUS.privacidade.titulo })).toBeInTheDocument()
    expect(screen.getByText(enUS.privacidade.rodapeStatus)).toBeInTheDocument()
    // A string pt equivalente NÃO aparece quando o locale é en-US.
    expect(screen.queryByText(ptBR.privacidade.rodapeStatus)).not.toBeInTheDocument()
  })

  it('PUBLICADA: zero placeholder/[validar] no render — nenhum badge de TODO nem chaves cruas', () => {
    const { container } = renderAt('pt-BR')
    // Publicada: nenhum placeholder sobrou → nenhum badge de TODO.
    expect(container.querySelectorAll('[data-todo]').length).toBe(0)
    // E o texto renderizado não contém chaves cruas, nem anotações de rascunho.
    expect(container.textContent).not.toContain('{')
    expect(container.textContent).not.toContain('}')
    expect(container.textContent).not.toContain('[validar')
  })

  it('v3: renderiza os itens 3.1 a 3.9, as seções 8 e 9 e o histórico de versões', () => {
    renderAt('pt-BR')
    const m = ptBR.privacidade
    for (const titulo of [
      m.s31Titulo,
      m.s32Titulo,
      m.s33Titulo,
      m.s34Titulo,
      m.s35Titulo,
      m.s36Titulo,
      m.s37Titulo,
      m.s38Titulo,
      m.s39Titulo,
    ]) {
      expect(screen.getByRole('heading', { level: 4, name: titulo })).toBeInTheDocument()
    }
    expect(screen.getByRole('heading', { level: 3, name: m.s8Titulo })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: m.s9Titulo })).toBeInTheDocument()
    expect(m.s8Titulo.startsWith('8.')).toBe(true)
    expect(m.s9Titulo.startsWith('9.')).toBe(true)
    for (const versao of m.s9Historico) expect(screen.getByText(versao)).toBeInTheDocument()
    // O rodapé repete a última versão do histórico (versão e data).
    const ultima = m.s9Historico[m.s9Historico.length - 1]
    expect(ultima.startsWith(`${m.rodapeVersao} — ${m.rodapeData}`)).toBe(true)
    // 11 direitos, o último sobre decisão automatizada (Art. 20).
    expect(m.s7Direitos).toHaveLength(11)
    expect(screen.getByText(m.s7Direitos[10])).toBeInTheDocument()
  })

  it('tabelas de prestadores (item 5) e de cookies (item 8): uma linha por entrada, colunas do mesmo tamanho', () => {
    for (const m of [ptBR.privacidade, enUS.privacidade]) {
      expect(m.s5ParaQue).toHaveLength(m.s5Prestadores.length)
      expect(m.s5Categorias).toHaveLength(m.s5Prestadores.length)
      expect(m.s8ParaQue).toHaveLength(m.s8Nomes.length)
      expect(m.s8Duracoes).toHaveLength(m.s8Nomes.length)
    }
    const { container } = renderAt('pt-BR')
    const tabelas = container.querySelectorAll('table')
    expect(tabelas).toHaveLength(2)
    const m = ptBR.privacidade
    expect(tabelas[0].querySelectorAll('tbody tr')).toHaveLength(m.s5Prestadores.length)
    expect(tabelas[1].querySelectorAll('tbody tr')).toHaveLength(m.s8Nomes.length)
    expect(screen.getByRole('rowheader', { name: 'Proton' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: m.s8Nomes[0] })).toBeInTheDocument()
  })

  it('tabelas acessíveis: cabeçalho com scope="col" e a 1ª coluna como cabeçalho de linha (scope="row")', () => {
    const { container } = renderAt('pt-BR')
    const m = ptBR.privacidade
    for (const [tabela, cabecalho, nomes] of [
      [container.querySelectorAll('table')[0], m.s5Cabecalho, m.s5Prestadores],
      [container.querySelectorAll('table')[1], m.s8Cabecalho, m.s8Nomes],
    ] as const) {
      const colunas = [...tabela.querySelectorAll('thead th')]
      expect(colunas.map((th) => th.textContent)).toEqual([...cabecalho])
      expect(colunas.every((th) => th.getAttribute('scope') === 'col')).toBe(true)
      const linhas = [...tabela.querySelectorAll('tbody tr')]
      expect(linhas.map((tr) => tr.querySelector('th[scope="row"]')?.textContent)).toEqual([...nomes])
      // Cada linha: 1 cabeçalho de linha + as demais colunas como células.
      for (const tr of linhas) expect(tr.querySelectorAll('td')).toHaveLength(cabecalho.length - 1)
    }
  })

  it('não fala mais em encarregado nomeado nem em revisão em andamento', () => {
    const { container } = renderAt('pt-BR')
    expect(container.textContent).not.toContain('Encarregado pelo tratamento de dados (DPO): Fernando Lisboa')
    expect(container.textContent).not.toContain('revisão jurídica em andamento')
    expect(container.textContent).not.toContain('ainda será fechado')
  })

  it('o e-mail real do canal aparece (canal publicado, não placeholder)', () => {
    const { container } = renderAt('pt-BR')
    expect(container.textContent).toContain('privacidade@refogando.com')
  })

  it('paridade de comprimento das listas pt-BR/en-US da seção privacidade', () => {
    const pt = ptBR.privacidade as Record<string, unknown>
    const en = enUS.privacidade as Record<string, unknown>
    for (const key of Object.keys(pt)) {
      const pv = pt[key]
      if (Array.isArray(pv)) {
        expect(Array.isArray(en[key]), `en-US.${key} deve ser array`).toBe(true)
        expect((en[key] as unknown[]).length, `comprimento de ${key}`).toBe(pv.length)
      }
    }
  })
})
