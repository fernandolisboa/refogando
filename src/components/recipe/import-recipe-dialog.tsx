'use client'
/**
 * Modal de IMPORTAÇÃO de um link da web (#169, ADR-0019) — a ponte explícita "exibir link ≠
 * importar". Cada resultado "da web" da Busca (#164) vira o GATILHO deste diálogo: clicar abre uma
 * confirmação de que a receita será COPIADA para o perfil PRIVADO do usuário, creditando a FONTE
 * (nunca republicada). Confirmar → `POST /api/recipes/import` com a `url` → 201 leva o usuário à
 * receita importada (`onImported(recipeId)`); 422 (sem JSON-LD confiável) e demais falhas viram
 * mensagem localizada, mantendo o "Ver no site" como saída.
 *
 * VISITANTE (não logado): importar exige conta — o diálogo troca a confirmação por um convite de
 * entrar (espelha o gate de `GerarComIaCta`/`RecipeDetailActions`: o gate de escrita REAL é
 * server-side, 401; aqui é só a afordância). Otimista durante o `sessionPending` (mostra o ramo
 * logado — o pior caso é um clique que cai no 401 do servidor, nunca um flash de convite a quem
 * está logado).
 *
 * A11y (de graça pela primitiva Radix Dialog, a MESMA do Sheet de #163 — ADR-0018): `role=dialog`
 * + `aria-modal`, trap de foco, foco move pro painel ao abrir e volta ao gatilho ao fechar, Escape
 * fecha, clique no overlay fecha, e o gatilho ganha `aria-expanded`/`aria-controls`. Tokens da
 * casa (bg-bg/border-border); sem accent/destructive (ADR-0004: âmbar é exclusivo do Aviso).
 */
import { useState } from 'react'
import { Dialog } from 'radix-ui'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

/** Um link da web (#164) — o resultado externo que pode ser importado. */
export type WebLink = { title: string; url: string; sourceName: string }

/** Rótulos JÁ localizados do modal de importação (o componente é PURO de i18n — não usa locale). */
export type ImportDialogLabels = {
  titulo: string
  /** Corpo com `{fonte}` interpolado pelo componente. */
  texto: string
  confirmar: string
  verNoSite: string
  cancelar: string
  importando: string
  erroNaoImportavel: string
  erroGenerico: string
  conviteTitulo: string
  conviteTexto: string
  signInLabel: string
  daWebFonte: string
}

type Status = 'idle' | 'importing' | 'error'

export function ImportRecipeDialog({
  link,
  authed,
  sessionPending,
  labels,
  onImported,
}: {
  link: WebLink
  authed: boolean
  sessionPending: boolean
  labels: ImportDialogLabels
  /** Sucesso (201): navega à receita importada (ou a "Minhas criações"). */
  onImported: (recipeId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  // Distingue 422 (site sem JSON-LD ⇒ "não importável") das demais falhas (genérico).
  const [naoImportavel, setNaoImportavel] = useState(false)

  // Visitante (sessão resolvida e SEM usuário): convite de entrar. Otimista durante o pending.
  const visitante = !authed && !sessionPending

  async function handleImport() {
    if (status === 'importing') return
    setStatus('importing')
    setNaoImportavel(false)
    try {
      const res = await fetch('/api/recipes/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: link.url }),
      })
      if (res.status === 201) {
        const body = (await res.json()) as { recipeId: string }
        onImported(body.recipeId)
        return
      }
      // 422: o site não publica os dados estruturados de que precisamos (no_jsonld/locale).
      if (res.status === 422) setNaoImportavel(true)
      setStatus('error')
    } catch {
      setStatus('error')
    }
  }

  // Reset do estado de erro ao fechar/reabrir (o próximo open começa limpo).
  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setStatus('idle')
      setNaoImportavel(false)
    }
  }

  const fonte = labels.daWebFonte.replace('{fonte}', link.sourceName)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {/* GATILHO = o card do resultado da web. `asChild` para o gatilho ser o próprio <button>
          (Radix liga aria-expanded/aria-controls). É um botão (abre modal), NÃO um <a> — o link
          externo "Ver no site" vive DENTRO do modal (saída explícita). */}
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="flex w-full flex-col gap-0.5 rounded-md border border-border bg-surface px-4 py-3 text-left hover:border-fg"
        >
          <span className="font-display text-base font-medium text-fg">{link.title}</span>
          <span className="text-xs text-muted">{fonte}</span>
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-fg/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border border-border bg-bg p-6 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          {visitante ? (
            <>
              <Dialog.Title className="font-display text-lg font-semibold text-fg">
                {labels.conviteTitulo}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted">
                {labels.conviteTexto}
              </Dialog.Description>
              <div className="flex flex-wrap items-center gap-3">
                <Button asChild>
                  <Link href="/sign-in">{labels.signInLabel}</Link>
                </Button>
                {/* Saída "Ver no site" preservada mesmo p/ o visitante (exibir link ≠ importar). */}
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow external"
                  className="text-sm text-muted hover:text-fg hover:underline"
                >
                  {labels.verNoSite}
                </a>
              </div>
            </>
          ) : (
            <>
              <Dialog.Title className="font-display text-lg font-semibold text-fg">
                {labels.titulo}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted">
                {labels.texto.replace('{fonte}', link.sourceName)}
              </Dialog.Description>

              {status === 'error' && (
                <p role="alert" className="text-sm font-medium text-fg">
                  {naoImportavel ? labels.erroNaoImportavel : labels.erroGenerico}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={handleImport}
                  disabled={status === 'importing'}
                  aria-busy={status === 'importing'}
                >
                  {status === 'importing' ? labels.importando : labels.confirmar}
                </Button>
                {/* Saída explícita pro site de origem (link externo) — sempre disponível. */}
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow external"
                  className="text-sm text-muted hover:text-fg hover:underline"
                >
                  {labels.verNoSite}
                </a>
                <Dialog.Close asChild>
                  <Button type="button" variant="secondary">
                    {labels.cancelar}
                  </Button>
                </Dialog.Close>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
