'use client'
/**
 * Modo CONVERSA da tela CRIAR unificada (#104 S4) — uma VISTA FOCADA, NÃO um log de chat.
 * Em vez do histórico inteiro rolando, mostra só o ÚLTIMO par de falas (o pedido do Usuário +
 * a resposta concisa da IA) e a RECEITA como herói embaixo. Enviar um novo turno naturalmente
 * SOBRESCREVE o par visível (porque só renderizamos o último) e a Receita troca no lugar. O
 * histórico completo fica atrás de "Ver transcrição" (modal read-only, #104 S3).
 *
 * REUSO total da máquina existente: o cérebro é `useConversationChat` (não muda contrato de
 * rota/NDJSON). Espelha conversation-experience.tsx nos GUARDS de sessão (loading/Visitante/
 * retomada-falhou), nos banners (erro/queda/resultado) e no diálogo de apagar (a11y verbatim).
 * A ÚNICA divergência de guard: a retomada-falhou aponta para `/create?mode=conversa` (não
 * `/conversation`), porque a entrada limpa do Modo Conversa agora é a tela CRIAR unificada.
 *
 * ADR-0009/0010/0011: a UI consome ROUTE HANDLERS via fetch (no hook); a AUTENTICAÇÃO e o
 * LOCALE ficam NESTE componente (o hook não faz auth nem `useLocale`). Âmbar é EXCLUSIVO do
 * Aviso de restrição; banners playful/erro/sistema usam tokens NEUTROS.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useConversationChat, type ChatMessage } from '@/hooks/use-conversation-chat'
import { recipeDetailPath } from '@/domain/recipe-detail-route'
import { RecipeDetailView } from './recipe-detail-view'
import { PortionScaleProvider } from './recipe-portion-scale-context'
import { useCozinhaVocab } from '@/components/i18n/cozinha-vocab-provider'
import { resolveCozinhaLabel } from '@/domain/cozinha-label'
import { TranscriptModal } from './transcript-modal'

/**
 * Último PAR de falas para a vista focada: a última fala do Usuário + a resposta do Assistente
 * que a SEGUE imediatamente (se houver). Null-safe e robusto às bordas:
 *  - transcript vazio → `{ user: null, assistant: null }` (nada inline; o herói/placeholder cuidam).
 *  - só uma fala do Usuário (turno em voo / após erro, que mantém o transcript terminando em
 *    'user') → user presente, assistant null.
 *  - termina em fala do Assistente (turno de sucesso fechou: …user, assistant) → ambos presentes.
 *  - termina em fala do Usuário após ERRO (a resposta do Assistente NÃO foi commitada) → user
 *    presente, assistant null.
 */
export function lastExchange(transcript: ChatMessage[]): {
  user: ChatMessage | null
  assistant: ChatMessage | null
} {
  // Índice da última fala do Usuário (varre de trás para frente).
  let userIdx = -1
  for (let i = transcript.length - 1; i >= 0; i--) {
    if (transcript[i].role === 'user') {
      userIdx = i
      break
    }
  }
  if (userIdx === -1) return { user: null, assistant: null }
  const user = transcript[userIdx]
  // A resposta do Assistente é a fala IMEDIATAMENTE após esse Usuário, se for do Assistente.
  const next = transcript[userIdx + 1]
  const assistant = next && next.role === 'assistant' ? next : null
  return { user, assistant }
}

export function ConversaFocusedView({ resumeSessionId }: { resumeSessionId?: string }) {
  const { locale, messages } = useLocale()
  const m = messages.conversa
  const cozinhaVocab = useCozinhaVocab() // #317: rótulo de cozinha do leitor (contexto ativo)
  const session = useSession()
  const pathname = usePathname()
  const returnTo = pathname ?? '/create'

  const {
    transcript,
    sessionId,
    input,
    status,
    liveAssistant,
    result,
    view,
    errorKey,
    loadFailed,
    deleteOpen,
    deleteError,
    resuming,
    resumeFailed,
    inFlight,
    setInput,
    setStatus,
    setDeleteOpen,
    headingRef,
    inputRef,
    dialogRef,
    deleteTriggerRef,
    carregarReceita,
    fecharDialogo,
    onSubmit,
    onKeyDown,
    redestilar,
    confirmarApagar,
    novaConversa,
  } = useConversationChat({ locale, resumeSessionId })

  // Modal da transcrição completa (#104 S3) — estado LOCAL desta vista (o hook não o conhece).
  const [transcricaoAberta, setTranscricaoAberta] = useState(false)

  // Placeholder ROTATIVO: cicla pelos exemplos curados, mas SÓ com o input vazio E ocioso (sem
  // mexer enquanto o usuário digita ou o turno corre). Limpa o intervalo no unmount.
  const placeholders = m.placeholders
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const podeRotacionar = input === '' && status === 'idle'
  useEffect(() => {
    if (!podeRotacionar) return
    const id = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % placeholders.length)
    }, 3500)
    return () => clearInterval(id)
  }, [podeRotacionar, placeholders.length])
  const placeholderAtual = placeholders[placeholderIdx % placeholders.length]

  // ── Guard de sessão (Visitante não usa o chat) ──────────────────────────────
  if (session.isPending || resuming) {
    return (
      <div aria-busy="true" className="text-muted">
        {messages.system.loading}
      </div>
    )
  }
  if (session.error || !session.data) {
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">{m.titulo}</h1>
        <p className="text-muted">{m.precisaEntrar}</p>
        <Button asChild>
          <Link href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>{messages.nav.signIn}</Link>
        </Button>
      </div>
    )
  }
  // Retomada falhou (404/rede): mensagem clara + caminho para uma conversa NOVA. A entrada
  // limpa do Modo Conversa agora é a tela CRIAR unificada (NÃO `/conversation`).
  if (resumeFailed) {
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">{m.titulo}</h1>
        <p role="alert" className="text-muted">
          {m.retomarFalhou}
        </p>
        <Button asChild>
          <Link href="/create?mode=conversa">{m.novaConversa}</Link>
        </Button>
      </div>
    )
  }

  const exchange = lastExchange(transcript)

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        {/* `criar.titulo` é o <h1> da tela; aqui usamos <h2> para não competir com o nome da
            Receita (que vira o <h1> via RecipeDetailView quando ela está na tela). O foco
            programático (swap de estado) pousa neste heading. */}
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="rounded-sm font-display text-2xl font-semibold tracking-tight text-fg outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-bg"
        >
          {m.titulo}
        </h2>
        <p className="max-w-[60ch] text-muted">{m.descricao}</p>
      </div>

      {/* VISTA FOCADA — só o último par de falas (não um log). `aria-live="polite"` anuncia a
          troca (os tokens incrementais entram pela bolha viva abaixo). A região PRÉ-existe. */}
      <section aria-label={m.titulo} className="flex flex-col gap-4">
        <div role="log" aria-live="polite" aria-busy={inFlight} className="flex flex-col gap-4">
          {exchange.user && (
            <div className="self-end max-w-[85%] rounded-md rounded-br-none border border-border bg-surface px-4 py-2.5">
              <p className="text-xs font-medium text-muted">{m.voce}</p>
              <p className="whitespace-pre-wrap text-pretty text-fg">{exchange.user.content}</p>
            </div>
          )}
          {/* A resposta da IA do par: a bolha VIVA (tokens em streaming) tem prioridade; senão a
              resposta commitada do último par. Só uma das duas aparece. */}
          {liveAssistant !== '' ? (
            <div className="self-start max-w-[85%] rounded-md rounded-bl-none border border-border bg-bg px-4 py-2.5">
              <p className="text-xs font-medium text-muted">{m.respostaIA}</p>
              <p className="whitespace-pre-wrap text-pretty text-fg">{liveAssistant}</p>
            </div>
          ) : (
            exchange.assistant && (
              <div className="self-start max-w-[85%] rounded-md rounded-bl-none border border-border bg-bg px-4 py-2.5">
                <p className="text-xs font-medium text-muted">{m.respostaIA}</p>
                <p className="whitespace-pre-wrap text-pretty text-fg">
                  {exchange.assistant.content}
                </p>
              </div>
            )
          )}
        </div>

        {/* Indicador de fase em voo (sutil, neutro). Região `role="status"` PRÉ-existente. */}
        <div role="status" aria-live="polite" className="min-h-0">
          {status === 'streaming' && liveAssistant === '' && (
            <p className="text-sm text-muted">{m.pensando}</p>
          )}
          {status === 'distilling' && <p className="text-sm text-muted">{m.destilando}</p>}
        </div>
      </section>

      {/* Entrada — sempre disponível (multi-turno); travada no turno em voo via fieldset. O
          placeholder ROTATIVO cicla só com o input vazio e ocioso. */}
      <form onSubmit={onSubmit} aria-busy={inFlight}>
        <fieldset disabled={inFlight} className="flex flex-col gap-3 border-0 p-0 disabled:opacity-60">
          <label htmlFor="conversa-input" className="text-sm font-medium text-fg">
            {m.inputLabel}
          </label>
          <Textarea
            id="conversa-input"
            ref={inputRef}
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholderAtual}
            className="resize-y"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              aria-busy={inFlight}
              disabled={inFlight || input.trim() === ''}
              className="disabled:cursor-not-allowed disabled:border disabled:border-border disabled:opacity-70"
            >
              {inFlight ? m.enviando : m.enviar}
            </Button>
            {/* Ver transcrição (#104 S3) — só quando há conversa; abre o modal read-only com o
                histórico COMPLETO. */}
            {transcript.length > 0 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setTranscricaoAberta(true)}
              >
                {m.verTranscricao}
              </Button>
            )}
            {/* Apagar conversa (#15) — só quando há conversa E uma Session segurada. Guarda o
                botão que abriu o diálogo p/ devolver-lhe o foco ao fechar (a11y). */}
            {sessionId && transcript.length > 0 && (
              <Button
                type="button"
                variant="secondary"
                onClick={(e) => {
                  deleteTriggerRef.current = e.currentTarget
                  setDeleteOpen(true)
                }}
              >
                {m.apagarTranscricao}
              </Button>
            )}
            {transcript.length > 0 && (
              <Button type="button" variant="secondary" onClick={novaConversa}>
                {m.novaConversa}
              </Button>
            )}
          </div>
        </fieldset>
      </form>

      {/* Região de RESULTADO/erro — PRÉ-existe (mesmo vazia) p/ o `aria-live` ser anunciado. A
          Receita é o HERÓI quando presente. */}
      <div aria-live="polite" className="flex flex-col gap-6">
        {/* Frame terminal de ERRO → erro de sistema neutro + CTA RE-DESTILAR. */}
        {status === 'error' && errorKey != null && (
          <div className="flex flex-col gap-3">
            <p
              role="alert"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg"
            >
              {errorKey === 'conflito_concorrente'
                ? m.erroConflito
                : errorKey === 'limite_geracao'
                  ? messages.criar.erroLimiteGeracao
                  : m.erroGeracao}
            </p>
            <div>
              <Button type="button" variant="secondary" onClick={redestilar}>
                {m.redestilar}
              </Button>
            </div>
          </div>
        )}

        {/* QUEDA de stream (sem frame terminal) — DISTINTA do frame de erro: aviso + RETOMAR. */}
        {status === 'dropped' && (
          <div className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3">
            <p className="font-medium text-fg">{m.quedaTitulo}</p>
            <p className="text-sm text-muted">{m.quedaNota}</p>
            <div>
              <Button type="button" variant="secondary" onClick={redestilar}>
                {m.retomar}
              </Button>
            </div>
          </div>
        )}

        {/* Resultado da destilação — a Receita como HERÓI. */}
        {status === 'result' &&
          result != null &&
          (result.outcome === 'impossible' ? (
            <>
              <p className="text-fg">{m.resultadoImpossivel}</p>
              {result.advisory && <p className="max-w-[60ch] text-muted">{result.advisory}</p>}
            </>
          ) : loadFailed || view == null ? (
            <>
              <p className="text-fg">{m.erroCarregarReceita}</p>
              {result.advisory && <p className="max-w-[60ch] text-muted">{result.advisory}</p>}
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setStatus('distilling')
                    void carregarReceita(result)
                  }}
                >
                  {m.tentarCarregarNovamente}
                </Button>
              </div>
            </>
          ) : (
            <>
              {/* Banner de desfecho — neutro (âmbar é EXCLUSIVO do Aviso de restrição). */}
              {result.outcome === 'playful' ? (
                <div className="flex flex-col gap-1 rounded-md border border-border bg-surface px-4 py-3">
                  <p className="font-medium text-fg">{m.playfulTitulo}</p>
                  <p className="text-sm text-muted">{m.playfulNota}</p>
                </div>
              ) : (
                <p className="font-medium text-fg">
                  {result.outcome === 'degraded' ? m.resultadoDegradado : m.resultadoSucesso}
                </p>
              )}

              {/* Comentário consultivo (advisory) — FORA do objeto Receita (CONTEXT.md). */}
              {result.advisory && (
                <p className="max-w-[60ch] text-muted">
                  <span className="font-medium text-fg">{m.consultoria}:</span> {result.advisory}
                </p>
              )}

              {/* A Receita destilada como HERÓI — REUSO total. O `<h1>{view.name}` é o ÚNICO `<h1>`.
                  #453: `PortionScaleProvider` com `key={view.id}` — nova destilação troca `view`. */}
              <PortionScaleProvider key={view.id} originalPorcoes={view.porcoes ?? 1}>
                <RecipeDetailView
                  view={view}
                  m={messages}
                  locale={locale}
                  cozinhaLabel={resolveCozinhaLabel(cozinhaVocab, view.facets.cozinha)}
                />
              </PortionScaleProvider>

              <div className="flex flex-wrap items-center gap-3">
                {/* Salvar/publicar REUSA a #59: navega pro detalhe. A Receita JÁ está persistida. */}
                {result.recipeId && (
                  <Button asChild>
                    {/* #231 (ADR-0020): a destilação não devolve slug — linka o fallback canônico por
                        UUID `/{locale}/recipes/<uuid>` (que 308a pro slug). Nunca link nu sem locale. */}
                    <Link href={recipeDetailPath(locale, result.recipeId)}>{m.verReceita}</Link>
                  </Button>
                )}
              </div>
            </>
          ))}
      </div>

      {/* Modal da transcrição COMPLETA (#104 S3) — read-only; foco capturado/restaurado pelo
          próprio modal. */}
      {transcricaoAberta && (
        <TranscriptModal
          transcript={transcript}
          titulo={m.transcricaoTitulo}
          closeLabel={m.apagarCancelar}
          voceLabel={m.voce}
          assistenteLabel={m.assistente}
          onClose={() => setTranscricaoAberta(false)}
        />
      )}

      {/* Diálogo de confirmação de APAGAR (IRREVERSÍVEL, #15/#60) — a11y verbatim do
          conversation-experience.tsx: role=dialog + aria-modal, Escape fecha, Tab faz trap,
          foco entra no primário (autoFocus) e VOLTA ao gatilho ao fechar (via fecharDialogo). */}
      {deleteOpen && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="apagar-titulo"
          aria-describedby="apagar-aviso"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              fecharDialogo()
              return
            }
            if (e.key === 'Tab') {
              const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
              )
              if (!focusables || focusables.length === 0) return
              const first = focusables[0]
              const last = focusables[focusables.length - 1]
              const active = document.activeElement
              if (e.shiftKey && active === first) {
                e.preventDefault()
                last.focus()
              } else if (!e.shiftKey && active === last) {
                e.preventDefault()
                first.focus()
              }
            }
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-fg/40 p-4"
        >
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-md border border-border bg-bg p-5 shadow-lg">
            <h2 id="apagar-titulo" className="font-display text-lg font-semibold text-fg">
              {m.apagarTituloConfirma}
            </h2>
            <p id="apagar-aviso" className="text-sm text-muted">
              {m.apagarAviso}
            </p>
            {deleteError && (
              <p
                role="alert"
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg"
              >
                {m.apagarErro}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button type="button" variant="secondary" onClick={fecharDialogo}>
                {m.apagarCancelar}
              </Button>
              <Button type="button" autoFocus onClick={() => void confirmarApagar()}>
                {m.apagarConfirmar}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
