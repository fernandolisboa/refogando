import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
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
import { resolveCozinhaLabel } from '@/domain/cozinha-label'
import { cozinhaVocabFixture } from '../helpers/cozinha-vocab'
import { handleResponse } from '@/server/http/handle-response'
import { resolvePageLocale, resolveContentLocale } from '@/server/http/page-locale'

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
    // `rawText` é o NOME do ingrediente SEM a medida (ADR-0012 Adendo 2026-06-30); `quantidade`/
    // `unidade` são a fonte ÚNICA da medida. A exibição COMPÕE "medida — nome" (`formatIngredientLine`).
    ingredients: [
      { ordem: 1, quantidade: '2.500', unidade: 'colher_de_sopa', rawText: 'feijão' },
    ],
    translations: [],
    // #161: por padrão a leitura NÃO repousa em tradução automática (sem selo). Cada caso que
    // exercita o selo sobrescreve `autoTranslationSignal: true`.
    autoTranslationSignal: false,
    ...over,
  }
}

// #317: a página resolve o rótulo de cozinha pelo leitor data-driven (escopo display) e passa
// por prop ao componente PURO. Os testes espelham isso usando a fixture do seed (#314).
const COZINHA_VOCAB = cozinhaVocabFixture('pt-BR')
function cozinhaLabelOf(view: RecipeView): string | null {
  return resolveCozinhaLabel(COZINHA_VOCAB, view.facets.cozinha)
}

function renderView(view: RecipeView) {
  return render(<RecipeDetailView view={view} m={M} locale="pt-BR" cozinhaLabel={cozinhaLabelOf(view)} />)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('RecipeDetailView (#57)', () => {
  it('Imagem da receita (#130): renderiza o hero quando há imageUrl; ausente ⇒ sem <img>', () => {
    const url = 'https://abc.public.blob.vercel-storage.com/recipes/x.webp'
    const { rerender } = renderView(baseView({ imageUrl: url }))
    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.src).toBe(url)
    expect(img).toHaveAttribute('alt', 'Texas Chili (chili do Texas)') // alt = nome da Receita

    // Sem imageUrl ⇒ estado limpo (nenhuma <img>).
    rerender(<RecipeDetailView view={baseView()} m={M} locale="pt-BR" />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('Selo "gerada por IA" (#132): aparece quando imageAiGenerated; ausente quando foto do usuário', () => {
    const url = 'https://abc.public.blob.vercel-storage.com/recipes/ia.webp'
    const { rerender } = renderView(baseView({ imageUrl: url, imageAiGenerated: true }))
    expect(screen.getByText(M.busca.imagemSeloIa)).toBeInTheDocument()

    rerender(<RecipeDetailView view={baseView({ imageUrl: url })} m={M} locale="pt-BR" />)
    expect(screen.queryByText(M.busca.imagemSeloIa)).not.toBeInTheDocument()
  })

  it('T1 — receita sem nada a sinalizar → conteúdo localizado + selo de catálogo, tela limpa', () => {
    renderView(baseView())

    // Título vem PRONTO da rota (original + tradução entre parênteses).
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('Texas Chili (chili do Texas)')

    // Seção Ingredientes + item: PROSA NATURAL com plural correto (ADR-0012 Adendo 2) — a fração
    // '2.500' vira o glifo misto '2½', a UNIDADE flexiona pela quantidade ('colheres de sopa', qty>1)
    // e o conector localizado 'de' liga ao nome: "2½ colheres de sopa de feijão".
    expect(
      screen.getByRole('heading', { name: M.detalhe.ingredientes, level: 2 }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(`2½ ${M.unidadeLabelPlural.colher_de_sopa} ${M.unidadeConector} feijão`),
    ).toBeInTheDocument()
    // REGRESSÃO (bug da medida duplicada do #354): a medida NÃO aparece duas vezes — o nome já vem
    // SEM medida, então nada de "2½ colheres de sopa de 2½ colheres de sopa de feijão".
    expect(screen.queryByText(/colheres de sopa.*colheres de sopa/)).toBeNull()
    // O token cru do enum NÃO vaza na tela, nem o numeric(10,3) cru.
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

  it('T1c — tempo de preparo (#261): total + ativo presentes → ambos com formato legível', () => {
    renderView(baseView({ tempoTotalMin: 90, tempoAtivoMin: 20 }))
    expect(screen.getByText(M.detalhe.tempoTotal)).toBeInTheDocument()
    expect(screen.getByText('1 h 30 min')).toBeInTheDocument()
    expect(screen.getByText(M.detalhe.tempoAtivo)).toBeInTheDocument()
    expect(screen.getByText('20 min')).toBeInTheDocument()
  })

  it('T1d — só o total presente → mostra total, omite ativo (ativo-sozinho é impossível)', () => {
    renderView(baseView({ tempoTotalMin: 45, tempoAtivoMin: null }))
    expect(screen.getByText(M.detalhe.tempoTotal)).toBeInTheDocument()
    expect(screen.getByText('45 min')).toBeInTheDocument()
    expect(screen.queryByText(M.detalhe.tempoAtivo)).toBeNull()
  })

  it('T1e — tempo ausente → nenhum rótulo de tempo', () => {
    renderView(baseView())
    expect(screen.queryByText(M.detalhe.tempoTotal)).toBeNull()
    expect(screen.queryByText(M.detalhe.tempoAtivo)).toBeNull()
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

  it('T3 — receita com staleNotice → nota + link "ver o original" PREFIXADO no locale corrente + ?original', () => {
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
    // Locale-no-caminho (#228/ADR-0020): o href fica PREFIXADO no locale CORRENTE (`notice.locale`,
    // = a chrome em que a nota foi renderizada — en-US aqui) pra NÃO trocar a chrome/o path, e usa
    // `?original=<originalLocale>` pra LER o corpo no idioma-fonte (a página honra esse escape —
    // ver T6b). NUNCA `?locale` (morreu com o path-wins) nem um link bare (que bounceria no proxy).
    const link = screen.getByRole('link', { name: 'View the original' })
    expect(link).toHaveAttribute('href', '/en-US/recipes/r-1?original=pt-BR')
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

  it('T7 — Autoria (#129): byline "por <name>" linka /u/<handle>; ausente no Catálogo', () => {
    // Com autor (Receita de Comunidade): byline visível e linkando o perfil público.
    renderView(baseView({ origin: 'ai_chat', author: { name: 'Ana Maria', handle: 'ana-maria' } }))
    const byline = screen.getByText('por Ana Maria')
    expect(byline).toBeInTheDocument()
    // O byline é um link para /u/<handle>.
    const link = byline.closest('a')
    expect(link).toHaveAttribute('href', '/u/ana-maria')

    // Sem autor (Catálogo): nenhum byline (sem crédito falso).
    cleanup()
    renderView(baseView({ origin: 'catalog' }))
    expect(screen.queryByText(/^por /)).toBeNull()
  })

  it('T7b — #169/ADR-0019: importada da web mostra "fonte: …" (link externo) no lugar de "por <name>"', () => {
    renderView(
      baseView({
        origin: 'web_imported',
        // a importada nunca traz author (read-model suprime); a vista carrega `source`.
        source: { url: 'https://www.tudogostoso.com.br/receita/123', name: 'TudoGostoso' },
      }),
    )
    // Crédito à FONTE: "fonte: TudoGostoso", linkando a URL de origem (externo).
    const fonte = screen.getByText('fonte: TudoGostoso')
    expect(fonte).toBeInTheDocument()
    const link = fonte.closest('a')!
    expect(link).toHaveAttribute('href', 'https://www.tudogostoso.com.br/receita/123')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')

    // NUNCA "por <name>" numa importada (creditada à fonte, não ao importador).
    expect(screen.queryByText(/^por /)).toBeNull()

    // Selo de proveniência específico "Importada da web" (não "Da comunidade").
    expect(screen.getByText(M.busca.seloImportada)).toBeInTheDocument()
    expect(screen.queryByText(M.busca.seloComunidade)).toBeNull()
  })

  it('T7c — #169: importada SEM source_name cai no HOST derivado da URL', () => {
    renderView(
      baseView({
        origin: 'web_imported',
        source: { url: 'https://panelinha.com.br/receita/feijoada' },
      }),
    )
    // Sem `name`, o crédito usa o host (sem "www.", sem path).
    expect(screen.getByText('fonte: panelinha.com.br')).toBeInTheDocument()
  })

  it('T8 — #161: ordem estilo Instagram (foto → título → descrição → ingredientes → passos → … → crédito ao final)', () => {
    const url = 'https://abc.public.blob.vercel-storage.com/recipes/x.webp'
    const { container } = renderView(
      baseView({
        imageUrl: url,
        origin: 'ai_chat',
        author: { name: 'Ana Maria', handle: 'ana-maria' },
      }),
    )

    // Marcos de ordem do DOM (topo→baixo): foto, título (h1), descrição (h2), ingredientes (h2),
    // passos (h2), crédito "por <Nome>" ao final. Ordem aferida por DOCUMENT_POSITION_FOLLOWING.
    const img = screen.getByRole('img')
    const h1 = screen.getByRole('heading', { level: 1 })
    const descricao = screen.getByRole('heading', { name: M.detalhe.descricao, level: 2 })
    const ingredientes = screen.getByRole('heading', { name: M.detalhe.ingredientes, level: 2 })
    const passos = screen.getByRole('heading', { name: M.detalhe.passos, level: 2 })
    const credito = screen.getByText('por Ana Maria')

    const inOrder = [img, h1, descricao, ingredientes, passos, credito]
    for (let i = 0; i < inOrder.length - 1; i++) {
      // node[i] precede node[i+1] no DOM (bit FOLLOWING setado).
      expect(
        inOrder[i].compareDocumentPosition(inOrder[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }

    // Crédito é o ÚLTIMO marco: nada de conteúdo de leitura (h2) vem depois dele.
    const headingsAfterCredit = container.querySelectorAll('h2')
    for (const h of headingsAfterCredit) {
      expect(
        credito.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeFalsy()
    }
  })

  it('T9 — #161: crédito "por <Nome>" é MENOR (text-xs/sm) e muted, ao final', () => {
    renderView(baseView({ origin: 'ai_chat', author: { name: 'Ana Maria', handle: 'ana-maria' } }))
    const credito = screen.getByText('por Ana Maria')
    // O parágrafo do crédito carrega tipografia diminuta (text-xs OU text-sm) + tom muted.
    const p = credito.closest('p')
    expect(p).not.toBeNull()
    expect(p?.className).toMatch(/\btext-(xs|sm)\b/)
    expect(p?.className).toContain('text-muted')
  })

  it('T10 — #161: selo "tradução automática" aparece quando autoTranslationSignal=true', () => {
    renderView(baseView({ autoTranslationSignal: true }))
    // Reusa o rótulo i18n já existente (busca.traducaoAutomatica = "tradução automática").
    const selo = screen.getByText(M.busca.traducaoAutomatica)
    expect(selo).toBeInTheDocument()
    // Discreto: tipografia diminuta + tom muted (não compete com o título).
    expect(selo.className).toMatch(/\btext-xs\b/)
    expect(selo.className).toContain('text-muted')
  })

  it('T11 — #161: selo "tradução automática" some quando autoTranslationSignal=false (tradução confiável/origem)', () => {
    renderView(baseView({ autoTranslationSignal: false }))
    expect(screen.queryByText(M.busca.traducaoAutomatica)).toBeNull()
  })

  // ── #237: aviso de catálogo AI-assistido (CORTESIA editorial) ────────────────────────────────────
  const DISCLOSURE = 'Algumas receitas são produzidas em colaboração entre curadoria e IA.'

  it('T12 — #237: renderiza o aviso de catálogo quando a página passa o texto (catálogo + ligado)', () => {
    render(
      <RecipeDetailView view={baseView({ origin: 'catalog' })} m={M} locale="pt-BR" catalogDisclosure={DISCLOSURE} />,
    )
    // O texto configurável aparece, rotulado como bloco "Sobre este catálogo" (aside, não heading).
    const aviso = screen.getByText(DISCLOSURE)
    expect(aviso).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: M.detalhe.catalogoAvisoRotulo })).toBeInTheDocument()
    // CONTINUA mostrando o selo de proveniência obrigatório do catálogo (aviso NÃO o substitui).
    expect(screen.getByText(M.busca.seloCatalogo)).toBeInTheDocument()
  })

  it('T13 — #237: SEM o prop (desligado) o aviso some — Catálogo renderiza como hoje, com o selo intacto', () => {
    render(<RecipeDetailView view={baseView({ origin: 'catalog' })} m={M} locale="pt-BR" />)
    expect(screen.queryByText(DISCLOSURE)).toBeNull()
    expect(screen.queryByRole('complementary', { name: M.detalhe.catalogoAvisoRotulo })).toBeNull()
    // Selo obrigatório de catálogo permanece.
    expect(screen.getByText(M.busca.seloCatalogo)).toBeInTheDocument()
  })

  it('T14 — INEGOCIÁVEL: receita ai_chat/ai_generated mantém os selos OBRIGATÓRIOS com o aviso ON e OFF', () => {
    const url = 'https://abc.public.blob.vercel-storage.com/recipes/ia.webp'
    // A página NUNCA passa o texto para origens ≠ catalog (shouldShowCatalogDisclosure=false). Mesmo se
    // um bug passasse o texto, os selos obrigatórios (proveniência ai_* + "gerada por IA") são caminhos
    // SEPARADOS e seguem presentes. Provamos os dois cenários (com e sem o prop).
    for (const disclosure of [undefined, DISCLOSURE]) {
      cleanup()
      render(
        <RecipeDetailView
          view={baseView({ origin: 'ai_chat', imageUrl: url, imageAiGenerated: true })}
          m={M}
          locale="pt-BR"
          catalogDisclosure={disclosure}
        />,
      )
      // Selo de proveniência obrigatório (ai_* → Comunidade) presente.
      expect(screen.getByText(M.busca.seloComunidade)).toBeInTheDocument()
      // Selo de imagem obrigatório "✨ gerada por IA" presente.
      expect(screen.getByText(M.busca.imagemSeloIa)).toBeInTheDocument()
    }
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

  it('T6b — locale-no-caminho (#228): a CHROME segue o path; o CONTEÚDO segue ?original (ver o original)', () => {
    // Regressão da jornada "ver o original" sob locale-no-caminho. Sob `[locale]`, o segmento de
    // path é SEMPRE presente (urlLocale nunca null), então a chrome SEMPRE vem do path — o `?locale`
    // legado virou letra morta. O escape explícito que o banner emite é `?original`:

    // CHROME (resolvePageLocale): o path manda; cookie/Accept-Language são só rede de segurança.
    const chrome = resolvePageLocale({
      urlLocale: 'en-US', // params.locale (sempre presente sob [locale])
      cookieLocale: 'pt-BR',
      acceptLanguage: 'pt-BR',
    })
    expect(chrome).toBe('en-US')

    // CONTEÚDO (resolveContentLocale): com `?original` VÁLIDO, busca a tradução-fonte SEM trocar a
    // chrome. É o que mantém a feature "ver o original" viva (era o que o `?locale` morto fazia).
    expect(resolveContentLocale({ pageLocale: chrome, original: 'pt-BR' })).toBe('pt-BR')
    expect(resolveContentLocale({ pageLocale: chrome, original: 'PT-br' })).toBe('pt-BR') // case-insensitive

    // Sem `?original` (caso comum) OU `?original` inválido → o conteúdo SEGUE a chrome (path).
    expect(resolveContentLocale({ pageLocale: chrome, original: null })).toBe('en-US')
    expect(resolveContentLocale({ pageLocale: chrome, original: undefined })).toBe('en-US')
    expect(resolveContentLocale({ pageLocale: chrome, original: 'xx-YY' })).toBe('en-US')

    // O link que o banner emite (T3) e o que a página resolve concordam: a chrome FICA em en-US
    // (path) enquanto o conteúdo vira pt-BR (?original) — exatamente "ver o original sem trocar a
    // chrome". Antes deste fix, `pathLocale ?? sp.locale` fazia o path SEMPRE vencer e a feature
    // resolvia o conteúdo no locale do path (regressão silenciosa).
    expect(chrome).not.toBe(resolveContentLocale({ pageLocale: chrome, original: 'pt-BR' }))
  })
})
