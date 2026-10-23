import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

/**
 * Teste jsdom (sem DB) da página de Política de Privacidade PUBLICADA (#398 / parte de #276; v3, revisada
 * no parecer interno de 2026-10-22; v3.1 com a idade mínima, ADR-0051). Cobre:
 *  - render bilíngue das DUAS partes (Parte a + Parte b);
 *  - a estrutura da v3.1: itens 3.1 a 3.9, seção 8 (cookies, com tabela), seção 9 (crianças e adolescentes),
 *    seção 10 (alterações + histórico de versões), 11 direitos e as tabelas de prestadores e de cookies com
 *    colunas do mesmo tamanho;
 *  - PUBLICAÇÃO: nenhum placeholder/`[validar]` sobra no render (zero `[data-todo]`, zero `{`/`}`),
 *    e o e-mail real do canal (privacidade@refogando.com) aparece;
 *  - rodapé de status/versão, igual à última linha do histórico;
 *  - paridade de comprimento das listas pt-BR/en-US da seção (rede de segurança do teste node de paridade).
 */
import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import { PrivacyPolicy } from '@/components/legal/privacy-policy'
import {
  DATA_POLITICA_V3_2,
  DATA_POLITICA_V3_3,
  DATA_POLITICA_V3_4,
  DATA_POLITICA_V3_5,
  DATA_PUBLICACAO_TERMOS_V1,
} from '@/domain/legal-notice'

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

  it('v3.1: itens 3.1 a 3.9, seções 8, 9 (crianças e adolescentes) e 10 (alterações + histórico)', () => {
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
    const s8 = screen.getByRole('heading', { level: 3, name: m.s8Titulo })
    const s9 = screen.getByRole('heading', { level: 3, name: m.s9Titulo })
    const s10 = screen.getByRole('heading', { level: 3, name: m.s10Titulo })
    expect(m.s8Titulo.startsWith('8.')).toBe(true)
    expect(m.s9Titulo.startsWith('9.')).toBe(true)
    expect(m.s10Titulo.startsWith('10.')).toBe(true)
    // Na ordem: 8 → 9 → 10.
    expect(s8.compareDocumentPosition(s9) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(s9.compareDocumentPosition(s10) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // A seção 9 diz a idade mínima, a mesma dos Termos de Uso.
    expect(screen.getByText(m.s9Corpo)).toBeInTheDocument()
    expect(m.s9Corpo).toContain('16 anos ou mais')
    expect(screen.getByText(m.s10Corpo)).toBeInTheDocument()
    for (const versao of m.s10Historico) expect(screen.getByText(versao)).toBeInTheDocument()
    // O rodapé repete a última versão do histórico (versão e data); cada versão desde a v3.1 tem a sua constante.
    const ultima = m.s10Historico[m.s10Historico.length - 1]
    expect(ultima.startsWith(`${m.rodapeVersao} — ${m.rodapeData}`)).toBe(true)
    expect(m.rodapeData).toBe(DATA_POLITICA_V3_5)
    expect(m.s10Historico.some((v) => v.startsWith(`v3.4 — ${DATA_POLITICA_V3_4}`))).toBe(true)
    expect(m.s10Historico.some((v) => v.startsWith(`v3.3 — ${DATA_POLITICA_V3_3}`))).toBe(true)
    expect(m.s10Historico.some((v) => v.startsWith(`v3.2 — ${DATA_POLITICA_V3_2}`))).toBe(true)
    expect(m.s10Historico.some((v) => v.startsWith(`v3.1 — ${DATA_PUBLICACAO_TERMOS_V1}`))).toBe(true)
    // 11 direitos, o último sobre decisão automatizada (Art. 20).
    expect(m.s7Direitos).toHaveLength(11)
    expect(screen.getByText(m.s7Direitos[10])).toBeInTheDocument()
  })

  it('#600: o item 3.5 diz que guardamos a data e a versão do consentimento, e que saem junto ao desmarcar', () => {
    expect(ptBR.privacidade.s35Valores[0]).toContain('a data e a versão do texto com que você consentiu')
    expect(enUS.privacidade.s35Valores[0]).toContain('the date and the version of the text you consented to')
    expect(ptBR.privacidade.s35Valores[3]).toContain('a data e a versão do consentimento saem junto')
    for (const m of [ptBR.privacidade, enUS.privacidade]) {
      expect(m.s10Historico.some((v) => v.startsWith(`v3.3 — ${DATA_POLITICA_V3_3}`))).toBe(true)
    }
  })

  it('#606: o item 3.6 diz o que fica do encerramento da conta pela equipe, por quanto tempo e com que base; o Resend manda o aviso', () => {
    const pt = ptBR.privacidade
    const en = enUS.privacidade
    expect(pt.s36Valores[0]).toContain('se a equipe encerrar a sua conta')
    expect(pt.s36Valores[0]).toContain('se tentamos avisar você por e-mail')
    expect(pt.s36Valores[2]).toContain('para o registro do encerramento da conta, exercício regular de direitos — Art. 7º, VI')
    expect(pt.s36Valores[3]).toContain('o registro do encerramento da conta pela equipe, por 5 anos')
    expect(en.s36Valores[0]).toContain('if the team closes your account')
    expect(en.s36Valores[2]).toContain('for the record of an account closure, the regular exercise of rights — Art. 7, VI')
    expect(en.s36Valores[3]).toContain('the record of an account closure by the team, for 5 years')
    const resend = pt.s5Prestadores.indexOf('Resend')
    expect(pt.s5ParaQue[resend]).toContain('aviso de encerramento da conta')
    expect(en.s5ParaQue[resend]).toContain('account closure notice')
    for (const m of [pt, en]) {
      expect(m.s10Historico.some((v) => v.startsWith(`v3.4 — ${DATA_POLITICA_V3_4}`))).toBe(true)
    }
  })

  it('#610: o item 3.1 diz que o seu @ aparece nas cópias das suas receitas, com as duas saídas; a preferência é dado da conta', () => {
    const pt = ptBR.privacidade
    const en = enUS.privacidade
    expect(pt.s31Valores[0]).toContain('se você quer o seu nome nas cópias que outras pessoas publicam das suas receitas')
    expect(pt.s31Valores[1]).toContain('Baseada na receita … de @você')
    expect(pt.s31Valores[1]).toContain('desligar isso em Editar perfil ou retirar o seu nome de uma cópia')
    expect(en.s31Valores[0]).toContain('whether you want your name on the copies other people publish of your recipes')
    expect(en.s31Valores[1]).toContain('Based on … by @you')
    for (const m of [pt, en]) {
      expect(m.s10Historico.some((v) => v.startsWith(`v3.5 — ${DATA_POLITICA_V3_5}`))).toBe(true)
      expect(m.rodapeVersao).toBe('v3.5')
      expect(m.rodapeData).toBe(DATA_POLITICA_V3_5)
    }
  })

  it('#599: a revisão de imagens da curadoria não é exceção do conteúdo privado, só da foto de receita publicada', () => {
    expect(ptBR.privacidade.s4Itens[0]).toContain('com uma exceção: os ingredientes fora do vocabulário')
    expect(ptBR.privacidade.s4Itens[0]).toContain('as outras imagens da galeria e as de receitas privadas ficam fora da fila')
    expect(enUS.privacidade.s4Itens[0]).toContain('with one exception: the out-of-vocabulary ingredients')
    expect(enUS.privacidade.s4Itens[0]).toContain('the other images in the gallery and those of private recipes stay out of the queue')
    expect(ptBR.privacidade.s33Valores[1]).toContain('quando viram a foto de uma receita publicada')
    expect(enUS.privacidade.s33Valores[1]).toContain('once they become the photo of a published recipe')
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
