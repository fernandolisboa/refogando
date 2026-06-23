'use client'
/**
 * Drawer "Nova receita" (#191, ADR-0021) — a criação por IA deixa a tela /create lotada e migra
 * para um DRAWER da direita (sobre a primitiva `Sheet`/Radix Dialog), aberto pelo botão "Criar"
 * do nav (por cima da tela atual, sem navegar) e pelo shell `/create` (semeado por deep-links).
 *
 * Esta FATIA entrega: o método-picker (3 cards) + o caminho **Prompt aberto** (`free_text`)
 * ponta-a-ponta, reusando `CreateStructuredExperience` (forçada em `free_text`, toggle interno
 * oculto). Os outros dois caminhos (Estruturado / Conversa) ficam como placeholders "em breve"
 * até as fatias #2/#3 — mas a SEMEADURA por `?q`/`?resume`/`?mode=conversa` já roteia certo.
 *
 * SEAM de heading/foco (F1 CANCELADO): o `<h1>` do nome da Receita e o `headingRef`/foco-ao-gerar
 * continuam DENTRO de `CreateStructuredExperience` — NÃO sobem para este shell. O `SheetTitle`
 * (Radix `Dialog.Title`, renderiza `<h2>`) dá o NOME ACESSÍVEL do diálogo sem competir com o
 * `<h1>` interno. O Radix foca o painel ao abrir; o `useEffect` do componente interno move o
 * foco para o `<h1>` da Receita na transição "gerou".
 *
 * Reabrir o drawer RESETA o wizard (paridade com o protótipo) via `key` no conteúdo interno —
 * assim trocar de método/gerar/voltar ao picker é estado local, sem vazar entre aberturas.
 */
import { useState, type ReactNode } from 'react'
import { useLocale } from '@/i18n/provider'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { CreateStructuredExperience } from './create-structured-experience'
import { CreateStructuredWizard } from './create-structured-wizard'

/** Caminho escolhido no método-picker. `null` = ainda no picker. */
type Method = null | 'estruturado' | 'prompt' | 'conversa'

export function CreateDrawer({
  open,
  onOpenChange,
  // Semeadura por deep-link (ADR-0021, dec. 2). Lidos pelo shell `/create` a partir da URL;
  // o nav passa-os ausentes (abre limpo no método-picker).
  //  - `initialQ` (#166): termo da ponte "gerar com IA" da Busca → entra no Prompt aberto já
  //    preenchido (o usuário ainda aciona "Gerar receita"; a Busca nunca gera).
  //  - `resumeSessionId`/`conversaHint`: retomada de Conversa → roteia pro caminho Conversa
  //    (placeholder nesta fatia, mas a semeadura NÃO pode quebrar).
  initialQ,
  resumeSessionId,
  conversaHint = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialQ?: string
  resumeSessionId?: string
  conversaHint?: boolean
}) {
  const { messages } = useLocale()
  const d = messages.criarDrawer

  // #191 (ADR-0021, dec. 5): o drawer é "aberto e bloqueante" enquanto uma geração está EM VOO.
  // Fechar no meio (ESC/scrim/X) desmontaria `CreateStructuredExperience` e ORFANARIA o
  // `POST /api/generations` (o servidor conclui, cria a Receita e consome cap, mas o usuário não
  // vê). Não há cancel/abort hoje — a geração é bounded por `maxDuration=60`; mantemos o painel
  // aberto até resolver. O inner sinaliza o loading via `onLoadingChange`; aqui interceptamos
  // ESC / pointer-down-outside / o `onOpenChange` do X e bloqueamos o dismiss enquanto `generating`.
  const [generating, setGenerating] = useState(false)

  // #193: o wizard estruturado registra um handler de "voltar" STEP-AWARE (passo>0 volta um
  // passo; passo 0 volta ao método-picker) e o stepper a renderizar no header. O `‹` do header
  // delega ao handler quando há um; senão volta ao picker. `null` = sem wizard ativo.
  const [wizardBack, setWizardBack] = useState<(() => void) | null>(null)
  const [stepNode, setStepNode] = useState<ReactNode>(null)

  // Só REPASSA o dismiss quando NÃO está gerando. O X (`SheetClose`) e qualquer outro caminho
  // chamam `onOpenChange` — abrir sempre passa; fechar é engolido durante a geração.
  const handleOpenChange = (next: boolean) => {
    if (!next && generating) return
    onOpenChange(next)
  }

  // Método escolhido. Reaberturas re-semeiam o método inicial a partir dos deep-links.
  const seededMethod = (): Method => {
    if (initialQ && initialQ.trim() !== '') return 'prompt'
    if (resumeSessionId || conversaHint) return 'conversa'
    return null
  }
  const [method, setMethod] = useState<Method>(seededMethod)
  // Reabrir o drawer reseta o wizard ao método semeado (paridade com openDrawer do protótipo) e
  // `nonce` força a remontagem do conteúdo interno (limpa o estado de CreateStructuredExperience).
  // Em vez de um effect (que dispararia o lint `set-state-in-effect`), seguimos o padrão React de
  // AJUSTAR estado DURANTE o render quando um valor-chave muda — aqui, a TRANSIÇÃO de `open` para
  // `true` (e a assinatura dos deep-links). `prevOpenSig` guarda o último (open + assinatura)
  // processado; quando o drawer passa a estar aberto com uma assinatura nova, re-semeamos.
  const [nonce, setNonce] = useState(0)
  const seedSig = open ? `open:${initialQ ?? ''}:${resumeSessionId ?? ''}:${conversaHint}` : 'closed'
  const [prevSeedSig, setPrevSeedSig] = useState(seedSig)
  if (seedSig !== prevSeedSig) {
    setPrevSeedSig(seedSig)
    if (open) {
      setMethod(seededMethod())
      setNonce((n) => n + 1)
      // Reabrir limpa o chrome do wizard (handler/stepper) — a remontagem o re-registra.
      setWizardBack(null)
      setStepNode(null)
    }
  }

  // Voltar ao método-picker pelo header: zera o estado e o chrome do wizard.
  function voltarParaPicker() {
    setMethod(null)
    setWizardBack(null)
    setStepNode(null)
  }

  // O `‹` do header delega ao back STEP-AWARE do wizard quando ativo; senão volta ao picker.
  const handleHeaderBack = wizardBack ?? voltarParaPicker

  const headerTitle =
    method === null
      ? d.tituloPicker
      : method === 'prompt'
        ? d.tituloPrompt
        : method === 'estruturado'
          ? d.tituloEstruturado
          : d.tituloConversa

  const hasBack = method !== null

  const methodCards: { key: Exclude<Method, null>; title: string; desc: string }[] = [
    { key: 'estruturado', title: d.metodoEstruturadoTitulo, desc: d.metodoEstruturadoDesc },
    { key: 'prompt', title: d.metodoPromptTitulo, desc: d.metodoPromptDesc },
    { key: 'conversa', title: d.metodoConversaTitulo, desc: d.metodoConversaDesc },
  ]

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        closeLabel={d.fechar}
        className="w-full gap-6 overflow-y-auto sm:max-w-md"
        // Bloqueia o dismiss por ESC / clique fora enquanto a geração roda (ver `generating`).
        // O `preventDefault` impede o Radix de fechar; o painel segue "aberto e bloqueante".
        onEscapeKeyDown={(e) => {
          if (generating) e.preventDefault()
        }}
        onPointerDownOutside={(e) => {
          if (generating) e.preventDefault()
        }}
      >
        <SheetHeader className="flex flex-col gap-0">
          <div className="flex flex-row items-start gap-3">
            {hasBack && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={d.voltar}
                onClick={handleHeaderBack}
                className="-ml-2 shrink-0"
              >
                ‹
              </Button>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-brand-ink">
                {d.kicker}
              </span>
              <SheetTitle className="font-display text-xl font-semibold tracking-tight text-fg">
                {headerTitle}
              </SheetTitle>
              <SheetDescription className="sr-only">{d.descricaoAcessivel}</SheetDescription>
            </div>
          </div>
          {/* Stepper do wizard estruturado (#193) — reportado pelo componente interno. */}
          {stepNode}
        </SheetHeader>

        {/* Método-picker (3 cards). Escolher um card troca o estado local — não navega. */}
        {method === null && (
          <div className="flex flex-col gap-4">
            <p className="text-muted">{d.pickerIntro}</p>
            {methodCards.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setMethod(c.key)}
                className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4 text-left shadow-sm transition-colors hover:border-brand/60 hover:bg-brand/5"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-display text-base font-semibold tracking-tight text-fg">
                    {c.title}
                  </span>
                  <span className="text-sm text-muted">{c.desc}</span>
                </span>
                <span aria-hidden className="shrink-0 text-muted">
                  ›
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Prompt aberto (free_text) — ponta-a-ponta. Reusa o cérebro de geração existente; o
            seam de heading/foco (h1 do nome da Receita ao gerar) mora DENTRO dele. `key` remonta
            a cada abertura/escolha de método (estado limpo). */}
        {method === 'prompt' && (
          <CreateStructuredExperience
            key={`prompt-${nonce}`}
            forceMode="free_text"
            hideModeToggle
            initialFreeText={initialQ}
            onLoadingChange={setGenerating}
          />
        )}

        {/* Formulário estruturado (#193) — wizard de 3 passos que monta o Briefing e gera via o
            caminho `structured` (POST /api/generations). Reusa o motor de geração/result/cap/erro
            do spine (`useRecipeGeneration` + `GenerationResultRegion`); o `‹` do header delega ao
            back step-aware do wizard e o stepper sobe pro header. `key` remonta a cada abertura. */}
        {method === 'estruturado' && (
          <CreateStructuredWizard
            key={`estruturado-${nonce}`}
            onExit={voltarParaPicker}
            // `setState` com função-valor: embrulha (senão React trataria o handler como updater).
            // `null` zera o chrome (sem wizard ativo) → o `‹` volta ao método-picker.
            onBackHandlerChange={(h) => setWizardBack(h ? () => h : null)}
            onStepLabelChange={setStepNode}
            onLoadingChange={setGenerating}
          />
        )}
        {method === 'conversa' && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
            <p className="font-medium text-fg">{d.emBreve}</p>
            <p className="text-sm text-muted">{d.emBreveConversa}</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
