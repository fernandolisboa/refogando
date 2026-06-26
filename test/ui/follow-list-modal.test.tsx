import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Modal da lista COMPLETA de seguidores/seguindo (#307) — seam jsdom. Reusa o `Sheet` (Radix Dialog ⇒
 * role=dialog, foco, Esc) e busca `/api/u/<handle>/<kind>` on-demand (Modelo B: sem seed SSR). Cobre:
 * abre → busca página 1 e renderiza cada item como link `/u/<handle>`; "carregar mais" SÓ com nextCursor
 * e APPENDA sem dup; vazio; erro; e RESET de estado ao trocar kind/handle (sem vazar lista entre aberturas).
 * Mockamos `next/link` (→ <a>) e `fetch`.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

import { ptBR } from '@/i18n/messages/pt-BR'
import { FollowListModal } from '@/components/profile/follow-list-modal'

const MP = ptBR.perfilPublico

type Reply = { ok: boolean; status?: number; body: unknown }
/** Stub de fetch que devolve, por chamada, a próxima resposta da fila (ou repete a última). */
function mockFetch(replies: Reply[]) {
  let i = 0
  const calls: string[] = []
  const impl = vi.fn(async (url: unknown) => {
    calls.push(String(url))
    const r = replies[Math.min(i, replies.length - 1)]
    i++
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { impl, calls }
}

/** Stub de fetch CONTROLÁVEL: cada chamada devolve uma promise que só resolve quando o teste manda
 * (`resolveNext`). Pra cravar o estado de carregamento (página 1 em voo) e a janela do duplo-clique. */
function deferredFetch() {
  const resolvers: Array<(r: Reply) => void> = []
  const calls: string[] = []
  const impl = vi.fn((url: unknown) => {
    calls.push(String(url))
    return new Promise<Response>((resolve) => {
      resolvers.push((r: Reply) =>
        resolve({ ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.body } as Response),
      )
    })
  })
  vi.stubGlobal('fetch', impl)
  return {
    impl,
    calls,
    async resolveNext(r: Reply) {
      // espera a chamada existir (o efeito pode não ter rodado ainda) e resolve a mais antiga pendente.
      await waitFor(() => expect(resolvers.length).toBeGreaterThan(0))
      resolvers.shift()!(r)
    },
  }
}

function user(handle: string) {
  return { name: `Chef ${handle}`, handle, image: null }
}

function renderModal(
  props: Partial<{ handle: string; kind: 'followers' | 'following'; open: boolean }> = {},
) {
  const { handle = 'chef-ana', kind = 'followers', open = true } = props
  return render(
    <FollowListModal
      handle={handle}
      kind={kind}
      open={open}
      onOpenChange={() => {}}
      labels={MP}
    />,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FollowListModal — busca e render', () => {
  it('aberto: busca página 1 de followers e renderiza cada item como link /u/<handle>', async () => {
    const { calls } = mockFetch([{ ok: true, body: { items: [user('bia'), user('caio')], nextCursor: null } }])
    renderModal({ handle: 'chef-ana', kind: 'followers' })
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(MP.seguidoresTitulo)
    const bia = await screen.findByRole('link', { name: /bia/i })
    expect(bia).toHaveAttribute('href', '/u/bia')
    expect(screen.getByRole('link', { name: /caio/i })).toHaveAttribute('href', '/u/caio')
    expect(calls[0]).toContain('/api/u/chef-ana/followers')
  })

  it('título reflete o kind=following', async () => {
    mockFetch([{ ok: true, body: { items: [], nextCursor: null } }])
    renderModal({ kind: 'following' })
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog).toHaveTextContent(MP.seguindoTitulo))
  })

  it('não busca quando open=false', () => {
    const { impl } = mockFetch([{ ok: true, body: { items: [], nextCursor: null } }])
    renderModal({ open: false })
    expect(impl).not.toHaveBeenCalled()
  })
})

describe('FollowListModal — carregar mais', () => {
  it('mostra "carregar mais" só com nextCursor; clicar APPENDA a próxima página sem dup', async () => {
    const u = userEvent.setup()
    const { calls } = mockFetch([
      { ok: true, body: { items: [user('p1'), user('p2')], nextCursor: 'CUR1' } },
      { ok: true, body: { items: [user('p3')], nextCursor: null } },
    ])
    renderModal({ handle: 'chef-ana', kind: 'followers' })
    await screen.findByRole('link', { name: /p1/i })
    const more = screen.getByRole('button', { name: MP.carregarMais })
    await u.click(more)
    // 3ª pessoa appendada; as duas primeiras seguem (sem reset/dup).
    await screen.findByRole('link', { name: /p3/i })
    expect(screen.getByRole('link', { name: /p1/i })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /p1/i }).length).toBe(1)
    // a 2ª chamada carrega o cursor; some o botão (nextCursor null).
    expect(calls[1]).toContain('cursor=CUR1')
    await waitFor(() => expect(screen.queryByRole('button', { name: MP.carregarMais })).toBeNull())
  })

  it('sem nextCursor: nenhum "carregar mais"', async () => {
    mockFetch([{ ok: true, body: { items: [user('solo')], nextCursor: null } }])
    renderModal()
    await screen.findByRole('link', { name: /solo/i })
    expect(screen.queryByRole('button', { name: MP.carregarMais })).toBeNull()
  })

  it('falha no "carregar mais": mantém a lista já carregada + erro inline + botão p/ retry', async () => {
    const u = userEvent.setup()
    mockFetch([
      { ok: true, body: { items: [user('a'), user('b')], nextCursor: 'CUR1' } },
      { ok: false, status: 500, body: {} }, // page 2 falha
      { ok: true, body: { items: [user('c')], nextCursor: null } }, // retry OK
    ])
    renderModal()
    await screen.findByRole('link', { name: /a$/i })
    await u.click(screen.getByRole('button', { name: MP.carregarMais }))
    // a falha NÃO apaga a lista; mostra erro inline; o botão segue lá pra retentar.
    expect(await screen.findByText(MP.listaErroMais)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /a$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /b$/i })).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: MP.carregarMais })
    await u.click(retry)
    await screen.findByRole('link', { name: /c$/i }) // retry appendou a página
  })

  it('duplo-clique no "carregar mais" NÃO appenda a página duas vezes (guarda em voo)', async () => {
    const u = userEvent.setup()
    const def = deferredFetch()
    renderModal()
    await def.resolveNext({ ok: true, body: { items: [user('p1'), user('p2')], nextCursor: 'CUR1' } })
    await screen.findByRole('link', { name: /p1/i })
    const more = screen.getByRole('button', { name: MP.carregarMais })
    // 1º clique dispara a busca (botão fica disabled); o 2º não dispara nada.
    await u.click(more)
    await u.click(more)
    await def.resolveNext({ ok: true, body: { items: [user('p3')], nextCursor: null } })
    await screen.findByRole('link', { name: /p3/i })
    // página 1 + UM único load-more = 2 chamadas (não 3); p3 não duplicou.
    expect(def.impl).toHaveBeenCalledTimes(2)
    expect(screen.getAllByRole('link', { name: /p3/i }).length).toBe(1)
  })

  it('página 1 em voo: mostra o estado de carregando', async () => {
    const def = deferredFetch()
    renderModal()
    expect(await screen.findByText(MP.listaCarregando)).toBeInTheDocument()
    await def.resolveNext({ ok: true, body: { items: [user('z')], nextCursor: null } })
    await screen.findByRole('link', { name: /z/i })
    expect(screen.queryByText(MP.listaCarregando)).toBeNull()
  })
})

describe('FollowListModal — estados vazio/erro e reset', () => {
  it('vazio: mostra empty-state', async () => {
    mockFetch([{ ok: true, body: { items: [], nextCursor: null } }])
    renderModal()
    expect(await screen.findByText(MP.listaVazia)).toBeInTheDocument()
  })

  it('erro: fetch !ok → mensagem de erro', async () => {
    mockFetch([{ ok: false, status: 500, body: {} }])
    renderModal()
    expect(await screen.findByText(MP.listaErro)).toBeInTheDocument()
  })

  it('trocar kind reseta items/cursor (sem vazar a lista anterior)', async () => {
    const { impl } = mockFetch([
      { ok: true, body: { items: [user('antigo')], nextCursor: 'X' } },
      { ok: true, body: { items: [user('novo')], nextCursor: null } },
    ])
    const { rerender } = renderModal({ kind: 'followers' })
    await screen.findByRole('link', { name: /antigo/i })
    rerender(
      <FollowListModal handle="chef-ana" kind="following" open onOpenChange={() => {}} labels={MP} />,
    )
    await screen.findByRole('link', { name: /novo/i })
    // a lista antiga sumiu; a nova busca foi disparada.
    expect(screen.queryByRole('link', { name: /antigo/i })).toBeNull()
    expect(impl).toHaveBeenCalledTimes(2)
  })
})
