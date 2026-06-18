import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

// next/link precisa do AppRouterContext em runtime; no jsdom não há router montado.
// Mockamos pra um <a> simples — o que importa aqui é o href de "ver o original".
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

import { ptBR } from '@/i18n/messages/pt-BR'
import type { RecipeView } from '@/domain/recipe-read'
import { RecipeDetailView } from '@/components/recipe/recipe-detail-view'
import { handleResponse } from '@/server/http/handle-response'
import { resolvePageLocale } from '@/server/http/page-locale'

/**
 * Teste de COMPONENTE jsdom do detalhe da Receita (#57) — seam de frontend da #54 (sem
 * browser/Postgres). O nó testado é o PURO `RecipeDetailView` (a página depende de
 * `headers()`/fetch server, que lançam fora do request scope no jsdom). Fixtures no shape
 * REAL `RecipeView`. A lógica NOVA da página (status→efeito; precedência de `?locale`) é
 * coberta pelos helpers puros `handleResponse`/`resolvePageLocale` (T5/T6).
 */

const M = ptBR

/** Fixture no shape REAL da rota. `facets` SEMPRE completo e explícito — a rota nunca
 *  emite `restricoes: []` (ausente ≠ vazio), então overrides passam `facets` inteiro. */
function baseView(over: Partial<RecipeView> = {}): RecipeView {
  return {
    id: 'r-1',
    name: 'Texas Chili (chili do Texas)',
    origin: 'catalog',
    schemaVersion: 1,
    body: { descricao: 'Um chili picante.', passos: ['Refogue', 'Cozinhe'], notas: null },
    facets: { cozinha: 'mexicana', categoria: 'prato_principal', tags: ['picante'] },
    porcoes: 4,
    dificuldade: 2,
    // `unidade` é valor REAL do enum UNIDADES (token machine-readable); `quantidade` vem
    // como string do `numeric(10,3)` com zeros à direita (ex. '2.500') — ambos exercitam
    // a localização da unidade e a normalização da quantidade na view.
    ingredients: [{ ordem: 1, quantidade: '2.500', unidade: 'colher_de_sopa', rawText: 'feijão' }],
    translations: [],
    ...over,
  }
}

function renderView(view: RecipeView) {
  return render(<RecipeDetailView view={view} m={M} />)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('RecipeDetailView (#57)', () => {
  it('T1 — receita sem nada a sinalizar → conteúdo localizado + selo de catálogo, tela limpa', () => {
    renderView(baseView())

    // Título vem PRONTO da rota (original + tradução entre parênteses).
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('Texas Chili (chili do Texas)')

    // Seção Ingredientes + item: quantidade normalizada ('2.500'→'2.5'), unidade
    // LOCALIZADA (token 'colher_de_sopa'→ rótulo amigável), nunca o token cru.
    expect(
      screen.getByRole('heading', { name: M.detalhe.ingredientes, level: 2 }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(`2.5 ${M.unidadeLabel.colher_de_sopa} — feijão`),
    ).toBeInTheDocument()
    // O token cru NÃO vaza na tela.
    expect(screen.queryByText(/colher_de_sopa/)).toBeNull()
    expect(screen.queryByText(/2\.500/)).toBeNull()

    // Seção Modo de preparo + passo.
    expect(
      screen.getByRole('heading', { name: M.detalhe.passos, level: 2 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Refogue')).toBeInTheDocument()

    // Selo de proveniência: origin=catalog → "Do catálogo" (REUSO de busca), accent.
    const badge = screen.getByText(M.busca.seloCatalogo)
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass('bg-accent-surface')
    expect(badge).toHaveClass('text-accent-strong')

    // Dificuldade com denominador (desambigua o inteiro cru).
    expect(screen.getByText('2/5')).toBeInTheDocument()

    // Rótulo do grupo de Tags existe, mas NÃO é heading (rótulo de chip ≠ seção de
    // leitura): a árvore de headings fica só com as seções de conteúdo reais.
    expect(screen.getByText(M.detalhe.tags)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: M.detalhe.tags })).toBeNull()

    // Tela LIMPA: nenhum chrome de sinalização. Asserções load-bearing (não vácuas):
    // sem banner/aviso (role="note"), sem link "ver o original", sem aviso de restrição
    // (o avisoTitulo só existe como aria-label do RestrictionWarning → casar pelo NOME
    // acessível do role="note", não por queryByText, que nunca o acharia).
    expect(screen.queryByRole('note')).toBeNull()
    expect(screen.queryByText(M.traducao.verOriginal)).toBeNull()
    expect(screen.queryByRole('note', { name: M.detalhe.avisoTitulo })).toBeNull()
  })

  it('T1b — faceta escalar nula (porções/dificuldade) → bloco omitido', () => {
    renderView(baseView({ porcoes: null, dificuldade: null }))

    // Cozinha/categoria continuam (não nulas) — mas porções/dificuldade somem.
    expect(screen.getByText(M.detalhe.cozinha)).toBeInTheDocument()
    expect(screen.queryByText(M.detalhe.porcoes)).toBeNull()
    expect(screen.queryByText(M.detalhe.dificuldade)).toBeNull()
    expect(screen.queryByText('2/5')).toBeNull()
  })

  it('T2 — receita com aviso de restrição → banner âmbar, receita inteira preservada', () => {
    renderView(
      baseView({
        avisos: [
          {
            kind: 'contradicao',
            restricao: 'sem_gluten',
            alergeno: 'trigo',
            mensagem: 'Marcada como sem glúten, mas contém trigo — declarado, não verificado.',
          },
        ],
        facets: {
          cozinha: 'mexicana',
          categoria: 'prato_principal',
          tags: ['picante'],
          restricoes: ['sem_gluten'],
        },
      }),
    )

    const note = screen.getByRole('note')
    expect(note).toHaveTextContent(
      'Marcada como sem glúten, mas contém trigo — declarado, não verificado.',
    )
    // Token ÂMBAR (ADR-0004).
    expect(note).toHaveClass('bg-aviso-bg')

    // Toque leve: a receita continua INTEIRA (não bloqueia).
    expect(screen.getByText(/feijão/)).toBeInTheDocument()
    expect(screen.getByText('Refogue')).toBeInTheDocument()
  })

  it('T3 — receita com staleNotice → nota + link "ver o original" pro locale de origem', () => {
    renderView(
      baseView({
        id: 'r-1',
        staleNotice: {
          locale: 'en-US',
          originalLocale: 'pt-BR',
          mensagem: 'This translation may be out of date…',
          verOriginalLabel: 'View the original',
        },
      }),
    )

    expect(screen.getByText('This translation may be out of date…')).toBeInTheDocument()
    // O href usa view.id + ?locale=originalLocale (a página honra esse ?locale — ver T6).
    const link = screen.getByRole('link', { name: 'View the original' })
    expect(link).toHaveAttribute('href', '/recipes/r-1?locale=pt-BR')
  })

  it('T4 — restrições declaradas SEM aviso → chips neutros, sem âmbar', () => {
    renderView(
      baseView({
        avisos: undefined,
        facets: {
          cozinha: 'mexicana',
          categoria: 'prato_principal',
          tags: [],
          restricoes: ['vegano'],
        },
      }),
    )

    // Chip de restrição declarada (rótulo localizado), dentro de uma lista.
    const chip = screen.getByText(M.restricaoLabel.vegano)
    expect(chip).toBeInTheDocument()
    expect(chip.closest('ul')).toHaveAttribute('role', 'list')

    // Restrição declarada SEM contradição NÃO é aviso âmbar.
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('T5 — handleResponse mapeia status → efeito (caminho not-found, leak-safe)', () => {
    expect(handleResponse({ ok: false, status: 404 })).toEqual({ kind: 'notFound' })
    expect(handleResponse({ ok: false, status: 500 })).toEqual({ kind: 'error', status: 500 })
    expect(handleResponse({ ok: true, status: 200 })).toEqual({ kind: 'ok' })
  })

  it('T6 — resolvePageLocale: ?locale válido vence; inválido cai no cookie; ausente → Accept-Language; case-insensitive', () => {
    // URL válida vence o cookie.
    expect(
      resolvePageLocale({ urlLocale: 'pt-BR', cookieLocale: 'en-US', acceptLanguage: null }),
    ).toBe('pt-BR')
    // URL inválida → cai no cookie.
    expect(
      resolvePageLocale({ urlLocale: 'xx-YY', cookieLocale: 'en-US', acceptLanguage: null }),
    ).toBe('en-US')
    // Ausente → cookie nulo → Accept-Language.
    expect(
      resolvePageLocale({ urlLocale: null, cookieLocale: null, acceptLanguage: 'pt-BR' }),
    ).toBe('pt-BR')
    // Case-insensitive → forma canônica.
    expect(resolvePageLocale({ urlLocale: 'PT-br' })).toBe('pt-BR')
  })
})
