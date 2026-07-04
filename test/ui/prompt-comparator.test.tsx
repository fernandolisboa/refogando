import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Comparador de prompt (#425, ADR-0029 dec.7) — teste de COMPONENTE jsdom (seam #54). `fetch`
 * mockado no shape de `POST /api/admin/prompt-compare`: cada índice de fixture devolve os dois lados
 * (velho|novo) com Receita + imagem. Prova: rodar dispara o fan-out por-fixture; cada fixture rende
 * DUAS colunas (Velho|Novo) e a `<img>` quando há imagem.
 */

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { PromptComparator } from '@/components/admin/prompt-comparator'
import { FIXED_BRIEFINGS, type ComparisonResponse } from '@/domain/prompt-comparator'

const A = ptBR.admin

function side(id: string, s: 'old' | 'new'): ComparisonResponse['old'] {
  return {
    side: s,
    systemPrompt: `system prompt ${s} de ${id}`,
    outcome: 'success',
    recipe: {
      titulo: `Prato ${s}`,
      cozinha: 'italiana',
      dificuldade: 3,
      ingredientes: ['arroz — 320 g'],
      passos: ['Misture.', 'Cozinhe.'],
    },
    advisory: null,
    imageDataUrl: 'data:image/png;base64,AQIDBA==',
  }
}

function mockFetch() {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const body = JSON.parse(String(args[1]?.body ?? '{}')) as { fixtureIndex: number }
    const id = FIXED_BRIEFINGS[body.fixtureIndex].id
    const res: ComparisonResponse = { fixtureId: id, old: side(id, 'old'), new: side(id, 'new') }
    return { ok: true, status: 200, json: async () => res } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderComparator() {
  render(
    <LocaleProvider initialLocale="pt-BR">
      <PromptComparator />
    </LocaleProvider>,
  )
}

describe('PromptComparator — grid 2 colunas + imagem', () => {
  it('rodar dispara uma chamada por fixture e rende Velho|Novo com <img>', async () => {
    const fetchMock = mockFetch()
    renderComparator()

    await userEvent.click(screen.getByRole('button', { name: A.comparadorRodar }))

    // Uma chamada POST por fixture (fan-out por-fixture).
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(FIXED_BRIEFINGS.length)
    })

    // Cada fixture rende as DUAS colunas (Velho + Novo).
    await waitFor(() => {
      expect(screen.getAllByText(A.comparadorVelho)).toHaveLength(FIXED_BRIEFINGS.length)
      expect(screen.getAllByText(A.comparadorNovo)).toHaveLength(FIXED_BRIEFINGS.length)
    })

    // Imagem do prato presente (2 por fixture: velho + novo).
    expect(screen.getAllByAltText(A.comparadorImagemAlt).length).toBe(FIXED_BRIEFINGS.length * 2)
  })

  it('checkbox "gerar imagem" é opt-in (default desligado)', () => {
    mockFetch()
    renderComparator()
    const checkbox = screen.getByRole('checkbox', { name: A.comparadorGerarImagem })
    expect(checkbox).not.toBeChecked()
  })
})
