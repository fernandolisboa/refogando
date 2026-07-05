import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Re-tradução de defasadas (#499) — teste de COMPONENTE jsdom (seam #54): `fetch` mockado no shape
 * de `POST /api/admin/translations/retranslate`. Espelha `embedding-backfill.test.tsx` (#119):
 * clique POST + mostra re-traduzidas/puladas/faltam; erro 500 ⇒ alert. NÃO mocka next/navigation.
 */

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { TranslationRetranslate } from '@/components/admin/translation-retranslate'

const A = ptBR.admin

type FetchResult = { ok: boolean; status: number; body: unknown } | { reject: true }
function mockFetch(entry: FetchResult | FetchResult[]) {
  const calls: { method: string; url: string }[] = []
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    calls.push({ method: (args[1]?.method ?? 'GET').toUpperCase(), url: String(args[0]) })
    const list = Array.isArray(entry) ? entry : [entry]
    const r = list.length > 1 ? list.shift()! : list[0]
    if ('reject' in r) throw new TypeError('network down')
    return { ok: r.ok, status: r.status, json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { impl, calls }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderRetranslate() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <TranslationRetranslate />
    </LocaleProvider>,
  )
}

describe('TranslationRetranslate (#499)', () => {
  it('clique ⇒ POST retranslate + mostra re-traduzidas/puladas/faltam', async () => {
    const { calls } = mockFetch({ ok: true, status: 200, body: { retranslated: 3, degraded: 1, remaining: 2 } })
    const user = userEvent.setup()
    renderRetranslate()

    await user.click(screen.getByRole('button', { name: A.retranslateBtn }))

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')!.url).toBe('/api/admin/translations/retranslate')
    expect(
      await screen.findByText(
        A.retranslateResultado
          .replace('{retraduzidas}', '3')
          .replace('{puladas}', '1')
          .replace('{restantes}', '2'),
      ),
    ).toBeInTheDocument()
  })

  it('erro 500 ⇒ alert', async () => {
    mockFetch({ ok: false, status: 500, body: { error: 'erro_interno' } })
    const user = userEvent.setup()
    renderRetranslate()
    await user.click(screen.getByRole('button', { name: A.retranslateBtn }))

    expect(await screen.findByRole('alert')).toHaveTextContent(A.retranslateErro)
  })
})
