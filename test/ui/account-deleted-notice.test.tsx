import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Aviso "Sua conta foi excluída." (#595), montado no layout: consome UMA vez o sinal que o diálogo de
 * exclusão deixa no sessionStorage antes de recarregar a home. Sinal velho (mais de 30s) não mostra nada.
 */
import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'
import { AccountDeletedNotice } from '@/components/profile/account-deleted-notice'
import {
  ACCOUNT_DELETED_KEY,
  ACCOUNT_DELETED_TTL_MS,
  consumeAccountDeletedSignal,
  markAccountDeleted,
} from '@/components/profile/account-deleted-signal'

const m = ptBR.seusDados

function renderNotice(locale: Locale = 'pt-BR') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <AccountDeletedNotice />
    </LocaleProvider>,
  )
}

afterEach(() => {
  window.sessionStorage.clear()
})

describe('AccountDeletedNotice (#595)', () => {
  it('sem sinal: a região de status existe, vazia', async () => {
    renderNotice()
    const status = screen.getByRole('status')
    // Dá a vez ao timer da leitura do storage.
    await new Promise((r) => setTimeout(r, 10))
    expect(status).toBeEmptyDOMElement()
  })

  it('sinal recente: mostra o aviso e apaga o sinal (uma vez só)', async () => {
    markAccountDeleted()
    renderNotice()
    expect(await screen.findByText(m.excluida)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(m.excluida)
    expect(window.sessionStorage.getItem(ACCOUNT_DELETED_KEY)).toBeNull()
  })

  it('sinal com mais de 30s: não mostra nada e limpa o sinal', async () => {
    window.sessionStorage.setItem(ACCOUNT_DELETED_KEY, String(Date.now() - ACCOUNT_DELETED_TTL_MS - 1_000))
    renderNotice()
    await waitFor(() => expect(window.sessionStorage.getItem(ACCOUNT_DELETED_KEY)).toBeNull())
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('"Fechar" esconde o aviso', async () => {
    const user = userEvent.setup()
    markAccountDeleted()
    renderNotice()
    await screen.findByText(m.excluida)
    await user.click(screen.getByRole('button', { name: m.fechar }))
    expect(screen.queryByText(m.excluida)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('en-US: o aviso segue o idioma', async () => {
    markAccountDeleted()
    renderNotice('en-US')
    expect(await screen.findByText(enUS.seusDados.excluida)).toBeInTheDocument()
  })
})

describe('consumeAccountDeletedSignal', () => {
  it('valor que não é número ou do futuro não vale', () => {
    window.sessionStorage.setItem(ACCOUNT_DELETED_KEY, 'lixo')
    expect(consumeAccountDeletedSignal()).toBe(false)
    window.sessionStorage.setItem(ACCOUNT_DELETED_KEY, String(Date.now() + 60_000))
    expect(consumeAccountDeletedSignal()).toBe(false)
    expect(window.sessionStorage.getItem(ACCOUNT_DELETED_KEY)).toBeNull()
  })
})
