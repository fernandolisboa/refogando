import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import type { RecipeView } from '@/domain/recipe-read'
import { RecipeShareButton } from '@/components/recipe/recipe-share-button'
import { RecipePortionScaler } from '@/components/recipe/recipe-portion-scaler'
import { PortionScaleProvider } from '@/components/recipe/recipe-portion-scale-context'

const M = ptBR

/**
 * `RecipeShareButton` (#453) — Web Share API com fallback copiar-link. jsdom NÃO implementa
 * `navigator.share` (fica `undefined`, próprio do ambiente de teste), mas JÁ implementa um
 * `navigator.clipboard` real (in-memory) — por isso `vi.spyOn(navigator.clipboard, 'writeText')`
 * (não substituir `navigator`/`navigator.clipboard` inteiros por um objeto plano: o `navigator`
 * do jsdom tem propriedades/acessores próprios que uma sobrescrita ingênua não replica, e o
 * `Clipboard` real do jsdom continua acessível por baixo, mascarando o mock).
 * `navigator.share`, ausente por padrão, é adicionado via `Object.defineProperty` (própria,
 * configurável) e removido no `afterEach` (não é gerenciado por `vi.unstubAllGlobals`).
 */
function view(over: Partial<RecipeView> = {}): RecipeView {
  return {
    id: 'r-1',
    name: 'Chili do Texas',
    origin: 'catalog',
    schemaVersion: 1,
    body: { descricao: null, passos: ['Refogue', 'Cozinhe'], notas: null },
    facets: { cozinha: null, categoria: null, tags: [] },
    porcoes: 4,
    dificuldade: null,
    ingredients: [{ ordem: 1, quantidade: '2', unidade: 'dente', rawText: 'alho' }],
    translations: [],
    autoTranslationSignal: false,
    ...over,
  }
}

function renderButton(v: RecipeView = view()) {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <PortionScaleProvider originalPorcoes={v.porcoes ?? 1}>
        <RecipeShareButton view={v} />
      </PortionScaleProvider>
    </LocaleProvider>,
  )
}

/** Instala `navigator.share` como própria/configurável (ausente por padrão no jsdom). */
function stubNativeShare(impl: (data: ShareData) => Promise<void>) {
  const share = vi.fn(impl)
  Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true })
  return share
}

beforeEach(() => {
  vi.stubGlobal('location', { ...window.location, href: 'https://refogando.com/pt-BR/recipes/chili-do-texas' })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  // `navigator.share` não é gerido por `vi.unstubAllGlobals` (foi setado direto, não via stubGlobal).
  delete (navigator as { share?: unknown }).share
})

describe('RecipeShareButton (#453)', () => {
  it('com navigator.share disponível: chama com title + texto formatado (título+ingredientes+passos+link), SEM url separada', async () => {
    const share = stubNativeShare(async () => {})
    const user = userEvent.setup()

    renderButton()
    await user.click(screen.getByRole('button', { name: M.detalhe.compartilhar }))

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    const arg = share.mock.calls[0][0]
    expect(arg.title).toBe('Chili do Texas')
    expect(arg.url).toBeUndefined()
    expect(typeof arg.text).toBe('string')
    const text = arg.text as string
    expect(text).toContain('Chili do Texas')
    expect(text).toContain(`${M.detalhe.ingredientes}:`)
    expect(text).toContain('2 dentes de alho')
    expect(text).toContain(`${M.detalhe.passos}:`)
    expect(text).toContain('1. Refogue')
    expect(text.endsWith('https://refogando.com/pt-BR/recipes/chili-do-texas')).toBe(true)
  })

  it('cancelamento do usuário (AbortError) é SILENCIOSO — sem fallback, sem erro', async () => {
    const abortError = Object.assign(new Error('cancelado'), { name: 'AbortError' })
    const share = stubNativeShare(async () => {
      throw abortError
    })
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const user = userEvent.setup()

    renderButton()
    await user.click(screen.getByRole('button', { name: M.detalhe.compartilhar }))

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(writeText).not.toHaveBeenCalled() // NÃO cai no fallback — cancelamento não é erro
    expect(screen.queryByText(M.detalhe.linkCopiado)).toBeNull()
    expect(screen.queryByText(M.detalhe.compartilharErro)).toBeNull()
  })

  it('SEM navigator.share (ausente por padrão no jsdom): fallback copia SÓ O LINK e mostra confirmação', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const user = userEvent.setup()

    renderButton()
    await user.click(screen.getByRole('button', { name: M.detalhe.compartilhar }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://refogando.com/pt-BR/recipes/chili-do-texas'))
    expect(screen.getByText(M.detalhe.linkCopiado)).toBeInTheDocument()
  })

  it('escrita no clipboard REJEITADA ⇒ mensagem de erro (sem confirmação de copiado)', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    const user = userEvent.setup()

    renderButton()
    await user.click(screen.getByRole('button', { name: M.detalhe.compartilhar }))

    await waitFor(() => expect(screen.getByText(M.detalhe.compartilharErro)).toBeInTheDocument())
    expect(screen.queryByText(M.detalhe.linkCopiado)).toBeNull()
  })

  it('item sem quantidade estruturada participa do texto como está (contrato do escalador reusado)', async () => {
    const share = stubNativeShare(async () => {})
    const user = userEvent.setup()

    renderButton(
      view({ ingredients: [{ ordem: 1, quantidade: null, unidade: 'a_gosto', rawText: 'sal' }] }),
    )
    await user.click(screen.getByRole('button', { name: M.detalhe.compartilhar }))

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    const arg = share.mock.calls[0][0]
    expect(arg.text as string).toContain(`sal ${M.unidadeLabel.a_gosto}`)
  })

  it('REGRESSÃO (code-review #453): compartilha as quantidades ESCALADAS, não as originais, quando o usuário ajustou as porções', async () => {
    const share = stubNativeShare(async () => {})
    const user = userEvent.setup()
    const v = view({ porcoes: 4 })

    // Escalador e botão de compartilhar sob o MESMO PortionScaleProvider — espelha `DetailChrome`.
    render(
      <LocaleProvider initialLocale="pt-BR">
        <PortionScaleProvider originalPorcoes={4}>
          <RecipePortionScaler ingredients={v.ingredients} m={M} locale="pt-BR" />
          <RecipeShareButton view={v} />
        </PortionScaleProvider>
      </LocaleProvider>,
    )

    // Dobra de 4 → 8 porções (fator 2×) via o escalador.
    const aumentar = screen.getByRole('button', { name: M.detalhe.porcoesAumentar })
    for (let i = 0; i < 4; i++) await user.click(aumentar)
    expect(screen.getByText('4 dentes de alho')).toBeInTheDocument() // "2" × 2 = "4"

    await user.click(screen.getByRole('button', { name: M.detalhe.compartilhar }))

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    const text = share.mock.calls[0][0].text as string
    expect(text).toContain('4 dentes de alho') // ESCALADO, não "2 dentes de alho" (original)
  })
})
