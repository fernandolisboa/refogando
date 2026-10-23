import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Aviso de conta depois da recarga (#595), montado no layout: consome UMA vez o sinal que o diálogo de
 * exclusão deixa no sessionStorage antes de recarregar. "Sua conta foi excluída." ou, quando a sessão tinha
 * expirado, o `erroSessao`. Sinal velho (mais de 30s) ou malformado não mostra nada.
 */
import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'
import { AccountNotice } from '@/components/profile/account-notice'
import {
  ACCOUNT_NOTICE_KEY,
  ACCOUNT_NOTICE_TTL_MS,
  consumeAccountNotice,
  markAccountNotice,
} from '@/components/profile/account-notice-signal'

const m = ptBR.seusDados

function renderNotice(locale: Locale = 'pt-BR') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <AccountNotice />
    </LocaleProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe('AccountNotice (#595)', () => {
  it('sem sinal: a região de status existe, vazia', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    renderNotice()
    const status = screen.getByRole('status')
    // Espera a leitura do storage (num timer depois da montagem) antes de conferir que nada apareceu.
    await waitFor(() => expect(getItem).toHaveBeenCalledWith(ACCOUNT_NOTICE_KEY))
    expect(status).toBeEmptyDOMElement()
  })

  it('conta excluída: mostra o aviso e apaga o sinal (uma vez só)', async () => {
    markAccountNotice('excluida')
    renderNotice()
    expect(await screen.findByText(m.excluida)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(m.excluida)
    expect(window.sessionStorage.getItem(ACCOUNT_NOTICE_KEY)).toBeNull()
  })

  it('sessão expirada: o erroSessao do diálogo sobrevive à recarga, na região de status', async () => {
    markAccountNotice('sessao')
    renderNotice()
    expect(await screen.findByText(m.erroSessao)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(m.erroSessao)
    expect(screen.queryByText(m.excluida)).not.toBeInTheDocument()
    expect(window.sessionStorage.getItem(ACCOUNT_NOTICE_KEY)).toBeNull()
  })

  it('sinal com mais de 30s: não mostra nada e limpa o sinal', async () => {
    window.sessionStorage.setItem(ACCOUNT_NOTICE_KEY, `excluida:${Date.now() - ACCOUNT_NOTICE_TTL_MS - 1_000}`)
    renderNotice()
    await waitFor(() => expect(window.sessionStorage.getItem(ACCOUNT_NOTICE_KEY)).toBeNull())
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('"Fechar" esconde o aviso', async () => {
    const user = userEvent.setup()
    markAccountNotice('excluida')
    renderNotice()
    await screen.findByText(m.excluida)
    await user.click(screen.getByRole('button', { name: m.fechar }))
    expect(screen.queryByText(m.excluida)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('en-US: o aviso segue o idioma', async () => {
    markAccountNotice('sessao')
    renderNotice('en-US')
    expect(await screen.findByText(enUS.seusDados.erroSessao)).toBeInTheDocument()
  })
})

describe('consumeAccountNotice', () => {
  it('devolve o tipo uma vez e apaga o sinal', () => {
    markAccountNotice('excluida')
    expect(consumeAccountNotice()).toBe('excluida')
    expect(consumeAccountNotice()).toBeNull()
  })

  it('tipo desconhecido, sem separador, data que não é número ou do futuro não valem (e o sinal some)', () => {
    for (const raw of ['outro:1', 'lixo', 'excluida:lixo', `sessao:${Date.now() + 60_000}`]) {
      window.sessionStorage.setItem(ACCOUNT_NOTICE_KEY, raw)
      expect(consumeAccountNotice()).toBeNull()
      expect(window.sessionStorage.getItem(ACCOUNT_NOTICE_KEY)).toBeNull()
    }
  })
})
