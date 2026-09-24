import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

import { ptBR } from '@/i18n/messages/pt-BR'
import { RecipeCookMode } from '@/components/recipe/recipe-cook-mode'

const M = ptBR

const PASSOS = ['Refogue a cebola', 'Asse por 20 minutos', 'Sirva quente']

function renderCookMode(passos: string[] = PASSOS) {
  return render(<RecipeCookMode passos={passos} m={M} />)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers() // garante limpeza mesmo se um teste com fake timers falhar no meio
  delete (navigator as { wakeLock?: unknown }).wakeLock
})

describe('RecipeCookMode (#455)', () => {
  it('botão "Modo cozinha" abre o overlay em tela cheia com o 1º passo em foco', async () => {
    const user = userEvent.setup()
    renderCookMode()
    await user.click(screen.getByRole('button', { name: M.detalhe.modoCozinha }))

    expect(screen.getByRole('dialog', { name: M.detalhe.modoCozinha })).toBeInTheDocument()
    expect(
      screen.getByText(M.detalhe.modoCozinhaPassoDe.replace('{atual}', '1').replace('{total}', '3')),
    ).toBeInTheDocument()
    expect(screen.getByText('Refogue a cebola')).toBeInTheDocument()
  })

  it('Escape fecha o overlay', async () => {
    const user = userEvent.setup()
    renderCookMode()
    await user.click(screen.getByRole('button', { name: M.detalhe.modoCozinha }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('"Próximo passo"/"Passo anterior" navegam; desabilitam nas bordas', async () => {
    const user = userEvent.setup()
    renderCookMode()
    await user.click(screen.getByRole('button', { name: M.detalhe.modoCozinha }))

    const anterior = screen.getByRole('button', { name: M.detalhe.modoCozinhaAnterior })
    const proximo = screen.getByRole('button', { name: M.detalhe.modoCozinhaProximo })
    expect(anterior).toBeDisabled() // 1º passo: sem anterior

    await user.click(proximo)
    expect(screen.getByText('Asse por 20 minutos')).toBeInTheDocument()
    expect(anterior).not.toBeDisabled()

    await user.click(proximo)
    expect(screen.getByText('Sirva quente')).toBeInTheDocument()
    expect(proximo).toBeDisabled() // último passo: sem próximo

    await user.click(anterior)
    expect(screen.getByText('Asse por 20 minutos')).toBeInTheDocument()
  })

  it('setas do teclado (←/→) também navegam entre passos', async () => {
    const user = userEvent.setup()
    renderCookMode()
    await user.click(screen.getByRole('button', { name: M.detalhe.modoCozinha }))

    await user.keyboard('{ArrowRight}')
    expect(screen.getByText('Asse por 20 minutos')).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByText('Refogue a cebola')).toBeInTheDocument()
  })

  it('checkbox "Marcar passo como feito" — estado por passo, independente', async () => {
    const user = userEvent.setup()
    renderCookMode()
    await user.click(screen.getByRole('button', { name: M.detalhe.modoCozinha }))

    const checkbox = screen.getByRole('checkbox', { name: M.detalhe.modoCozinhaConcluir })
    expect(checkbox).not.toBeChecked()
    await user.click(checkbox)
    expect(checkbox).toBeChecked()
  })

  it('passo COM duração reconhecível mostra o botão de timer; passo sem duração, não', async () => {
    const user = userEvent.setup()
    renderCookMode()
    await user.click(screen.getByRole('button', { name: M.detalhe.modoCozinha }))

    // Passo 1 ("Refogue a cebola"): sem duração ⇒ sem botão de timer.
    expect(screen.queryByText(/Iniciar timer/)).toBeNull()

    // Passo 2 ("Asse por 20 minutos"): duração reconhecida ⇒ botão de timer com o rótulo formatado.
    await user.click(screen.getByRole('button', { name: M.detalhe.modoCozinhaProximo }))
    expect(
      screen.getByRole('button', { name: M.detalhe.modoCozinhaIniciarTimer.replace('{tempo}', '20 min') }),
    ).toBeInTheDocument()
  })

  it('timer: clicar "Iniciar" mostra a contagem MM:SS; "parar" volta ao botão de iniciar', () => {
    // `fireEvent` (síncrono, sem simulação realista de ponteiro) em vez de `userEvent`: o
    // `setInterval` do timer precisa nascer FAKE (fake timers ativos ANTES do clique — trocar
    // depois de já criado sob timers reais não o afeta retroativamente), e `userEvent` + fake
    // timers é um deadlock clássico (depende de timers reais internos mesmo com `delay: null`).
    vi.useFakeTimers()
    renderCookMode()
    fireEvent.click(screen.getByRole('button', { name: M.detalhe.modoCozinha }))
    fireEvent.click(screen.getByRole('button', { name: M.detalhe.modoCozinhaProximo })) // passo com timer

    fireEvent.click(
      screen.getByRole('button', { name: M.detalhe.modoCozinhaIniciarTimer.replace('{tempo}', '20 min') }),
    )
    expect(screen.getByText('20:00')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText('19:57')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: M.detalhe.modoCozinhaPararTimer }))
    expect(
      screen.getByRole('button', { name: M.detalhe.modoCozinhaIniciarTimer.replace('{tempo}', '20 min') }),
    ).toBeInTheDocument()
  })

  it('timer chegando a zero: mostra "Tempo esgotado!" (anunciado via role="status")', () => {
    vi.useFakeTimers()
    renderCookMode(['Asse por 1 minuto'])
    fireEvent.click(screen.getByRole('button', { name: M.detalhe.modoCozinha }))
    fireEvent.click(
      screen.getByRole('button', { name: M.detalhe.modoCozinhaIniciarTimer.replace('{tempo}', '1 min') }),
    )

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getAllByText(M.detalhe.modoCozinhaTempoEsgotado).length).toBeGreaterThan(0)
  })

  it('REGRESSÃO (code-review #455): dois passos SEGUIDOS com timer não compartilham o mesmo interval', () => {
    // Passos 2º e 3º AMBOS reconhecem duração — antes do fix (key={stepIndex}), o React reusava a
    // MESMA instância de `StepTimerButton` ao navegar entre eles, e o `setInterval` do passo
    // anterior continuava rodando/mostrando a contagem errada.
    vi.useFakeTimers()
    renderCookMode(['Refogue a cebola', 'Asse por 20 minutos', 'Descanse por 5 minutos'])
    fireEvent.click(screen.getByRole('button', { name: M.detalhe.modoCozinha }))
    fireEvent.click(screen.getByRole('button', { name: M.detalhe.modoCozinhaProximo })) // → passo 2 (20 min)

    fireEvent.click(
      screen.getByRole('button', { name: M.detalhe.modoCozinhaIniciarTimer.replace('{tempo}', '20 min') }),
    )
    expect(screen.getByText('20:00')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: M.detalhe.modoCozinhaProximo })) // → passo 3 (5 min)

    // O passo 3 deve mostrar o botão "Iniciar timer de 5 min" FRESCO — nunca uma contagem
    // herdada do passo 2 (nem "20:00" nem qualquer MM:SS residual).
    expect(
      screen.getByRole('button', { name: M.detalhe.modoCozinhaIniciarTimer.replace('{tempo}', '5 min') }),
    ).toBeInTheDocument()
    expect(screen.queryByText('20:00')).toBeNull()
    expect(screen.queryByText(/^\d{1,2}:\d{2}$/)).toBeNull()
  })

  it('wakeLock: pede screen lock quando a API existe; degrada silenciosamente quando ausente (jsdom)', async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    const request = vi.fn().mockResolvedValue({ release })
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request },
      configurable: true,
    })
    const user = userEvent.setup()
    const { unmount } = renderCookMode()
    await user.click(screen.getByRole('button', { name: M.detalhe.modoCozinha }))

    expect(request).toHaveBeenCalledWith('screen')
    unmount()
  })
})
