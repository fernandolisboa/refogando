'use client'
/**
 * Caminho CONVERSA do drawer "Nova receita" (#194, ADR-0021). Torna FUNCIONAL o card que era
 * placeholder "em breve": um chat multi-turno + a ação "Destilar receita", que transforma a
 * conversa numa Receita. É a contraparte enxuta da `ConversaFocusedView` (a vista focada de
 * `/create`), enxugada para caber no DRAWER.
 *
 * REUSO total do cérebro: o stream NDJSON, a destilação bloqueante, os estados (streaming/
 * distilling/result/error/dropped), a retomada (#15) e o cap #167 (429 nunca consome cap) vivem
 * em `useConversationChat` — NÃO reimplementamos nada disso. Aqui só montamos a JSX do drawer a
 * partir do "bag" do hook e reportamos o loading ao shell (`onLoadingChange`) para o drawer
 * travar o dismiss enquanto uma destilação está EM VOO (igual aos caminhos Prompt/Estruturado).
 *
 * INVARIANTE de heading (#194): a Conversa IDLE NÃO tem `<h1>` — o drawer já tem seu nome
 * acessível pelo `SheetTitle` (um `<h2>` do Radix). Quando a destilação cai em `result`, o nome
 * da Receita renderizado por `RecipeDetailView` vira o ÚNICO `<h1>` do documento. Diferente da
 * vista focada, NÃO renderizamos um `titulo`/`descricao` de página — o header do drawer já o faz.
 *
 * Diferenças de UI vs. a vista focada (deliberadas, para o drawer): sem o heading/descrição de
 * página, sem placeholders rotativos, e a ação primária é o botão "Destilar receita" (reusa
 * `redestilar`, que re-POSTa o transcript atual → o servidor decide o terminal `recipe`), além
 * do "Enviar" de cada turno. Apagar/Ver transcrição/Nova conversa ficam fora desta fatia (a
 * reabertura do drawer já zera o estado via `key`).
 */
import { useEffect } from 'react'
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useConversationChat } from '@/hooks/use-conversation-chat'
import { lastExchange } from './conversa-focused-view'
import { RecipeDetailView } from './recipe-detail-view'

export function CreateConversaExperience({
  resumeSessionId,
  onLoadingChange,
}: {
  resumeSessionId?: string
  onLoadingChange?: (loading: boolean) => void
}) {
  const { locale, messages } = useLocale()
  const m = messages.conversa
  const d = messages.criarDrawer

  const {
    transcript,
    input,
    status,
    liveAssistant,
    result,
    view,
    errorKey,
    loadFailed,
    resuming,
    resumeFailed,
    inFlight,
    setInput,
    setStatus,
    headingRef,
    inputRef,
    carregarReceita,
    onSubmit,
    onKeyDown,
    redestilar,
  } = useConversationChat({ locale, resumeSessionId })

  // Reporta o loading ao shell do drawer: enquanto uma destilação corre (streaming/distilling), o
  // drawer trava ESC/scrim/X (igual aos outros caminhos) — fechar orfanaria a geração em voo.
  useEffect(() => {
    onLoadingChange?.(inFlight)
  }, [inFlight, onLoadingChange])

  // Retomada em andamento: aguarda a reidratação (sem piscar o chat vazio).
  if (resuming) {
    return (
      <div aria-busy="true" className="text-muted">
        {messages.system.loading}
      </div>
    )
  }
  // Retomada falhou (404/rede): mensagem clara + saída para uma conversa nova (NÃO um chat vazio
  // quebrado). Na ENTRADA limpa do Modo Conversa unificado (a tela CRIAR), `/create?mode=conversa`.
  if (resumeFailed) {
    return (
      <div className="flex flex-col gap-4">
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
    <div className="flex flex-col gap-6">
      <p className="text-muted">{d.conversaIntro}</p>

      {/* VISTA FOCADA — só o último par de falas (não um log). `aria-live` anuncia a troca; o
          histórico completo NÃO é exposto nesta fatia do drawer. */}
      <section aria-label={d.tituloConversa} className="flex flex-col gap-4">
        <div role="log" aria-live="polite" aria-busy={inFlight} className="flex flex-col gap-4">
          {exchange.user && (
            <div className="self-end max-w-[85%] rounded-md rounded-br-none border border-border bg-surface px-4 py-2.5">
              <p className="text-xs font-medium text-muted">{m.voce}</p>
              <p className="whitespace-pre-wrap text-pretty text-fg">{exchange.user.content}</p>
            </div>
          )}
          {/* A bolha VIVA (tokens em streaming) tem prioridade; senão a resposta commitada do
              último par. Só uma das duas aparece. */}
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

        {/* Indicador de fase em voo (sutil, neutro). */}
        <div role="status" aria-live="polite" className="min-h-0">
          {status === 'streaming' && liveAssistant === '' && (
            <p className="text-sm text-muted">{m.pensando}</p>
          )}
          {status === 'distilling' && <p className="text-sm text-muted">{m.destilando}</p>}
        </div>
      </section>

      {/* Entrada — sempre disponível (multi-turno); travada no turno em voo via fieldset. */}
      <form onSubmit={onSubmit} aria-busy={inFlight}>
        <fieldset
          disabled={inFlight}
          className="flex flex-col gap-3 border-0 p-0 disabled:opacity-60"
        >
          <label htmlFor="conversa-drawer-input" className="text-sm font-medium text-fg">
            {m.inputLabel}
          </label>
          <Textarea
            id="conversa-drawer-input"
            ref={inputRef}
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={m.inputPlaceholder}
            className="resize-y"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant="secondary"
              aria-busy={inFlight}
              disabled={inFlight || input.trim() === ''}
              className="disabled:cursor-not-allowed disabled:opacity-70"
            >
              {inFlight ? m.enviando : m.enviar}
            </Button>
            {/* "Destilar receita" — transforma a conversa numa Receita (geração bloqueante após o
                stream). REUSA `redestilar` (re-POSTa o transcript atual; o servidor decide o
                terminal `recipe`). Só quando há conversa E nenhuma destilação em voo. */}
            {transcript.length > 0 && (
              <Button
                type="button"
                onClick={redestilar}
                disabled={inFlight}
                className="disabled:cursor-not-allowed disabled:opacity-70"
              >
                {d.destilarReceita}
              </Button>
            )}
          </div>
        </fieldset>
      </form>

      {/* Região de RESULTADO/erro — PRÉ-existe (mesmo vazia) p/ o `aria-live` ser anunciado. O
          `headingRef` (foco no swap de estado) pousa no TOPO desta região; a Receita é o HERÓI e
          seu nome é o ÚNICO `<h1>`. */}
      <div
        ref={headingRef as unknown as React.RefObject<HTMLDivElement>}
        tabIndex={-1}
        aria-live="polite"
        className="flex flex-col gap-6 rounded-sm outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-bg"
      >
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

        {/* QUEDA de stream (sem frame terminal) — DISTINTA do erro: aviso + RETOMAR. */}
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

              {/* A Receita destilada como HERÓI — REUSO total. `<h1>{view.name}` é o ÚNICO `<h1>`. */}
              <RecipeDetailView view={view} m={messages} />

              <div className="flex flex-wrap items-center gap-3">
                {/* Salvar/publicar REUSA a #59: navega pro detalhe. A Receita JÁ está persistida. */}
                {result.recipeId && (
                  <Button asChild>
                    <Link href={`/recipes/${result.recipeId}`}>{m.verReceita}</Link>
                  </Button>
                )}
              </div>
            </>
          ))}
      </div>
    </div>
  )
}
