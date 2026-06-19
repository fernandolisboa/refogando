'use client'
/**
 * Modo CONVERSA (#60) — wrapper FINO de UI sobre `useConversationChat` (#104 S1). O cérebro
 * (máquina de estados, refs, efeitos, ações de stream/destilação) mora no hook; este componente
 * só faz os guards de SESSÃO (Visitante/loading/retomada-falhou) e renderiza a JSX a partir do
 * "bag" do hook. Espelha a DISCIPLINA de `create-structured-experience.tsx`: UM único `<h1>`
 * por documento, região `aria-live` que PRÉ-existe no DOM, `<fieldset disabled>` durante o
 * envio, guard de Visitante.
 *
 * ADR-0009/0010/0011: a UI consome os ROUTE HANDLERS via `fetch` (no hook), NÃO reimplementa
 * domínio, e a AUTENTICAÇÃO é responsabilidade DESTE componente (o hook não faz auth) — passa
 * o `locale` resolvido para o hook.
 *
 * Âmbar é EXCLUSIVO do Aviso de restrição (`RestrictionWarning`); banners playful/erro/sistema
 * usam tokens NEUTROS.
 */
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { btnPrimary, btnSecondary, fieldClassName } from '@/components/button'
import { useConversationChat } from '@/hooks/use-conversation-chat'
import { RecipeDetailView } from './recipe-detail-view'

export function ConversationExperience({ resumeSessionId }: { resumeSessionId?: string }) {
  const { locale, messages } = useLocale()
  const m = messages.conversa
  const session = useSession()

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
        <Link href="/sign-in" className={btnPrimary}>
          {messages.nav.signIn}
        </Link>
      </div>
    )
  }
  // Retomada falhou (404/rede): mensagem clara + caminho para uma conversa NOVA (NÃO um chat
  // vazio que parece quebrado). `/conversation` é a entrada limpa de conversa nova (sem id).
  if (resumeFailed) {
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">{m.titulo}</h1>
        <p role="alert" className="text-muted">
          {m.retomarFalhou}
        </p>
        <Link href="/conversation" className={btnPrimary}>
          {m.novaConversa}
        </Link>
      </div>
    )
  }

  const temReceita = view != null
  // `conversa.titulo` cede o `<h1>` para o nome da Receita só quando ela está na tela.
  const Titulo = temReceita ? 'h2' : 'h1'

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Titulo
          ref={headingRef}
          tabIndex={-1}
          // Foco PROGRAMÁTICO (swap de estado) dispara `:focus`, NÃO `:focus-visible` (este é só
          // teclado) → o outline global não aparece. Sem indicador, o usuário de teclado fica
          // perdido. Anel visível explícito com o token de foco (--color-ring), em vez de
          // `outline-none` mudo. `rounded-sm` casa o offset com o estilo global de foco.
          className="rounded-sm font-display text-3xl font-semibold tracking-tight text-fg outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-bg sm:text-4xl"
        >
          {m.titulo}
        </Titulo>
        <p className="max-w-[60ch] text-muted">{m.descricao}</p>
      </div>

      {/* Histórico da conversa — falas commitadas + a bolha viva do Assistente em streaming.
          `role="log"` + `aria-live="polite"` para que os tokens incrementais sejam anunciados
          de forma não-intrusiva. A região PRÉ-existe (mesmo vazia). */}
      <section aria-label={m.titulo} className="flex flex-col gap-4">
        <ol role="log" aria-live="polite" aria-busy={inFlight} className="flex flex-col gap-4">
          {transcript.length === 0 && liveAssistant === '' && (
            <li className="text-muted">{m.conversaVazia}</li>
          )}
          {transcript.map((msg, i) => (
            <li
              key={i}
              className={
                msg.role === 'user'
                  ? 'self-end max-w-[85%] rounded-md rounded-br-none border border-border bg-surface px-4 py-2.5'
                  : 'self-start max-w-[85%] rounded-md rounded-bl-none border border-border bg-bg px-4 py-2.5'
              }
            >
              <p className="text-xs font-medium text-muted">
                {msg.role === 'user' ? m.voce : m.assistente}
              </p>
              <p className="whitespace-pre-wrap text-pretty text-fg">{msg.content}</p>
            </li>
          ))}
          {/* Bolha viva do Assistente — tokens incrementais durante o streaming. */}
          {liveAssistant !== '' && (
            <li className="self-start max-w-[85%] rounded-md rounded-bl-none border border-border bg-bg px-4 py-2.5">
              <p className="text-xs font-medium text-muted">{m.assistente}</p>
              <p className="whitespace-pre-wrap text-pretty text-fg">{liveAssistant}</p>
            </li>
          )}
        </ol>

        {/* Indicador de fase em voo (sutil, neutro). A região `role="status"` + `aria-live`
            PRÉ-existe no DOM (sempre montada, o conteúdo troca) p/ o leitor de tela ANUNCIAR a
            troca de fase (pensando → destilando); regiões live inseridas junto do conteúdo não
            são anunciadas por muitos leitores. Vazia → some visualmente (sem nó de texto). */}
        <div role="status" aria-live="polite" className="min-h-0">
          {status === 'streaming' && liveAssistant === '' && (
            <p className="text-sm text-muted">{m.pensando}</p>
          )}
          {status === 'distilling' && <p className="text-sm text-muted">{m.destilando}</p>}
        </div>
      </section>

      {/* Entrada — sempre disponível (multi-turno); travada durante o turno em voo via fieldset. */}
      <form onSubmit={onSubmit} aria-busy={inFlight}>
        <fieldset disabled={inFlight} className="flex flex-col gap-3 border-0 p-0 disabled:opacity-60">
          <label htmlFor="conversa-input" className="text-sm font-medium text-fg">
            {m.inputLabel}
          </label>
          <textarea
            id="conversa-input"
            ref={inputRef}
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={m.inputPlaceholder}
            className={`${fieldClassName} resize-y`}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              aria-busy={inFlight}
              disabled={inFlight || input.trim() === ''}
              // Cue de desabilitado ALÉM da opacidade (que sozinha é fraca p/ baixa visão):
              // cursor de bloqueio + borda neutra dão um sinal não-baseado-em-opacidade.
              className={`${btnPrimary} disabled:cursor-not-allowed disabled:border disabled:border-border disabled:opacity-70`}
            >
              {inFlight ? m.enviando : m.enviar}
            </button>
            {/* Apagar conversa (#15) — só quando há conversa E uma Session segurada. Guarda o
                botão que abriu o diálogo p/ devolver-lhe o foco ao fechar (a11y). */}
            {sessionId && transcript.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  deleteTriggerRef.current = e.currentTarget
                  setDeleteOpen(true)
                }}
                className={btnSecondary}
              >
                {m.apagarTranscricao}
              </button>
            )}
            {transcript.length > 0 && (
              <button type="button" onClick={novaConversa} className={btnSecondary}>
                {m.novaConversa}
              </button>
            )}
          </div>
        </fieldset>
      </form>

      {/* Região de RESULTADO/erro — PRÉ-existe (mesmo vazia) p/ o `aria-live` ser anunciado. O
          conteúdo entra/sai DENTRO dela. */}
      <div aria-live="polite" className="flex flex-col gap-6">
        {/* Frame terminal de ERRO → erro de sistema neutro + CTA RE-DESTILAR (NÃO Receita parcial). */}
        {status === 'error' && errorKey != null && (
          <div className="flex flex-col gap-3">
            <p
              role="alert"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg"
            >
              {errorKey === 'conflito_concorrente' ? m.erroConflito : m.erroGeracao}
            </p>
            <div>
              <button type="button" onClick={redestilar} className={btnSecondary}>
                {m.redestilar}
              </button>
            </div>
          </div>
        )}

        {/* QUEDA de stream (sem frame terminal) — DISTINTA do frame de erro: aviso + RETOMAR. */}
        {status === 'dropped' && (
          <div className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3">
            <p className="font-medium text-fg">{m.quedaTitulo}</p>
            <p className="text-sm text-muted">{m.quedaNota}</p>
            <div>
              <button type="button" onClick={redestilar} className={btnSecondary}>
                {m.retomar}
              </button>
            </div>
          </div>
        )}

        {/* Resultado da destilação. */}
        {status === 'result' && result != null && (
          result.outcome === 'impossible' ? (
            <>
              <p className="text-fg">{m.resultadoImpossivel}</p>
              {result.advisory && <p className="max-w-[60ch] text-muted">{result.advisory}</p>}
            </>
          ) : loadFailed || view == null ? (
            <>
              <p className="text-fg">{m.erroCarregarReceita}</p>
              {result.advisory && <p className="max-w-[60ch] text-muted">{result.advisory}</p>}
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setStatus('distilling')
                    void carregarReceita(result)
                  }}
                  className={btnSecondary}
                >
                  {m.tentarCarregarNovamente}
                </button>
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

              {/* A Receita destilada — REUSO total. O `<h1>{view.name}` aqui é o ÚNICO `<h1>`.
                  O Aviso de restrição (âmbar) sai DENTRO dela (view.avisos). */}
              <RecipeDetailView view={view} m={messages} />

              <div className="flex flex-wrap items-center gap-3">
                {/* Salvar/publicar REUSA a #59: navega pro detalhe (onde moram os controles de
                    Visibilidade). A Receita JÁ está persistida private — NÃO re-gera. */}
                {result.recipeId && (
                  <Link href={`/recipes/${result.recipeId}`} className={btnPrimary}>
                    {m.verReceita}
                  </Link>
                )}
              </div>
            </>
          )
        )}
      </div>

      {/* Diálogo de confirmação de APAGAR (IRREVERSÍVEL, #15/#60). Modal acessível:
          role="dialog" + aria-modal + aria-labelledby/describedby; Escape fecha; Tab faz trap
          dentro do diálogo; foco entra no botão primário (autoFocus) e VOLTA ao gatilho ao
          fechar (via fecharDialogo). */}
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
            // Trap de Tab: mantém o foco dentro do diálogo enquanto aberto (ciclo entre o 1º e
            // o último controle focável). Sem isso o Tab vaza para o conteúdo atrás do modal.
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
              <button type="button" onClick={fecharDialogo} className={btnSecondary}>
                {m.apagarCancelar}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => void confirmarApagar()}
                className={btnPrimary}
              >
                {m.apagarConfirmar}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
