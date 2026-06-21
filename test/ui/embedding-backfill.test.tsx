import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Backfill de embeddings (#119) — teste de COMPONENTE jsdom (seam #54): `fetch` mockado no shape de
 * `POST /api/admin/embeddings/recompute`. Cobre: clique POST + mostra recomputados/faltam; resultado
 * PARCIAL (embedder parou) usa a copy própria; erro 500 ⇒ alert. NÃO mocka next/navigation (não navega).
 */

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { EmbeddingBackfill } from '@/components/admin/embedding-backfill'

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

function renderBackfill() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <EmbeddingBackfill />
    </LocaleProvider>,
  )
}

describe('EmbeddingBackfill (#119)', () => {
  it('clique ⇒ POST recompute + mostra recomputados/faltam', async () => {
    const { calls } = mockFetch({ ok: true, status: 200, body: { recomputed: 3, remaining: 2 } })
    const user = userEvent.setup()
    renderBackfill()

    await user.click(screen.getByRole('button', { name: A.backfillBtn }))

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')!.url).toBe('/api/admin/embeddings/recompute')
    expect(
      await screen.findByText(
        A.backfillResultado.replace('{recomputados}', '3').replace('{restantes}', '2'),
      ),
    ).toBeInTheDocument()
  })

  it('resultado PARCIAL (embedder parou) ⇒ copy própria com a causa', async () => {
    mockFetch({ ok: true, status: 200, body: { recomputed: 1, remaining: 9, error: 'HTTP 429' } })
    const user = userEvent.setup()
    renderBackfill()
    await user.click(screen.getByRole('button', { name: A.backfillBtn }))

    expect(
      await screen.findByText(
        A.backfillResultadoParcial.replace('{recomputados}', '1').replace('{restantes}', '9'),
      ),
    ).toBeInTheDocument()
  })

  it('erro 500 ⇒ alert', async () => {
    mockFetch({ ok: false, status: 500, body: { error: 'erro_interno' } })
    const user = userEvent.setup()
    renderBackfill()
    await user.click(screen.getByRole('button', { name: A.backfillBtn }))

    expect(await screen.findByRole('alert')).toHaveTextContent(A.backfillErro)
  })
})
