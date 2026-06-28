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
  /** #272: o robots.txt do site proíbe a importação automática (403) — mensagem distinta. */
  erroRobotsBloqueado: string
  /** #272: rate-limit por domínio (429) — "muitas importações desse site; tente em instantes". */
  erroLimite: string
  erroGenerico: string
  conviteTitulo: string
  conviteTexto: string
  signInLabel: string
  daWebFonte: string
}

type Status = 'idle' | 'importing' | 'error'
/** Qual mensagem de erro mostrar — derivada da `reason` do corpo, NUNCA do status HTTP cru. */
type ErrorKind = 'naoImportavel' | 'robots' | 'limite' | 'generico'

/**
 * Mapeia a `reason` (corpo `{ error }` da rota) → mensagem. As três razões 422 ("o site não nos dá
 * dados importáveis") compartilham a mesma mensagem; `robots_blocked` (403) e `rate_limited` (429) têm
 * a sua; qualquer outra coisa — inclusive rede caída, corpo ilegível ou um 403 de SSRF
 * (`dominio_nao_permitido`) — cai no genérico. Discriminar pela REASON (não pelo status) evita pintar o
 * 403 do SSRF como "robôs".
 */
function errorKindFor(reason: string | undefined): ErrorKind {
  switch (reason) {
    case 'robots_blocked':
      return 'robots'
    case 'rate_limited':
      return 'limite'
    case 'no_jsonld':
    case 'unsupported_locale':
    case 'fetch_failed':
      return 'naoImportavel'
    default:
      return 'generico'
  }
}

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
  // Qual mensagem de erro mostrar — derivada da reason do corpo (errorKindFor), não do status cru.
  const [errorKind, setErrorKind] = useState<ErrorKind>('generico')

  // Visitante (sessão resolvida e SEM usuário): convite de entrar. Otimista durante o pending.
  const visitante = !authed && !sessionPending

  async function handleImport() {
    if (status === 'importing') return
    setStatus('importing')
    setErrorKind('generico')
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
      // Falha: discrimina pela REASON do corpo (`{ error }`); corpo ausente/ilegível ⇒ genérico.
      let reason: string | undefined
      try {
        reason = ((await res.json()) as { error?: string }).error
      } catch {
        reason = undefined
      }
      setErrorKind(errorKindFor(reason))
      setStatus('error')
    } catch {
      setErrorKind('generico')
      setStatus('error')
    }
  }

  // Reset do estado de erro ao fechar/reabrir (o próximo open começa limpo).
  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setStatus('idle')
      setErrorKind('generico')
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {/* GATILHO = a LINHA do resultado da web. `asChild` para o gatilho ser o próprio <button>
          (Radix liga aria-expanded/aria-controls). É um botão (abre modal), NÃO um <a> — o link
          externo "Ver no site" vive DENTRO do modal (saída explícita). #5 (protótipo final): linha
          COMPACTA — chip "web" + título (páprica, 1 linha truncada) + fonte à direita; divisória por
          border-bottom (o <ul> põe a border-top de cima). A atribuição completa vive no modal. */}
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 border-b border-border py-2.5 text-left transition-colors hover:bg-surface"
        >
          <span className="shrink-0 rounded border border-border px-1.5 py-px text-[0.625rem] font-medium text-muted">
            web
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-brand-ink">
            {link.title}
          </span>
          <span className="shrink-0 text-xs text-muted">{link.sourceName}</span>
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
                  {errorKind === 'robots'
                    ? labels.erroRobotsBloqueado
                    : errorKind === 'limite'
                      ? labels.erroLimite
                      : errorKind === 'naoImportavel'
                        ? labels.erroNaoImportavel
                        : labels.erroGenerico}
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
