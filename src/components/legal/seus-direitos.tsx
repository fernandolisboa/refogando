'use client'
/**
 * Corpo da página "Seus direitos / Privacidade" (#399, GAP-2; parte de #276) — PUBLICADA, com o
 * formulário público de intake embutido. Espelha `privacy-policy.tsx`: client component (acompanha o
 * locale em runtime), TODO o texto vem de `messages.seusDireitos` (i18n bilíngue) — nada hardcoded aqui.
 *
 * Publicada por decisão do dono, SEM o sign-off jurídico (que segue pendente em #276): os contatos
 * (nome/e-mail do encarregado) foram resolvidos com os valores reais direto nas strings i18n, e o canal
 * (e-mail + `TakedownForm`) já é funcional. `withPlaceholders` fica como rede de segurança (passthrough
 * hoje) — um teste garante que nenhum `{`/`}` sobra no render.
 */
import type { ReactNode } from 'react'
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'
import { TakedownForm } from '@/components/legal/takedown-form'

/**
 * Substitui cada placeholder `{...}` por um badge de TODO visível (mesmo padrão de `privacy-policy.tsx`).
 * Strings sem placeholder passam intactas — seguro aplicar a qualquer folha de texto.
 */
function withPlaceholders(text: string, todoLabel: string): ReactNode[] {
  const re = /\{([^{}]+)\}/g
  const nodes: ReactNode[] = []
  let last = 0
  let key = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    nodes.push(
      <mark
        key={`ph-${key++}`}
        data-todo=""
        title={todoLabel}
        className="mx-0.5 rounded-sm bg-aviso-bg px-1 font-medium text-aviso-fg"
      >
        <span className="sr-only">{todoLabel}: </span>‹{match[1]}›
      </mark>,
    )
    last = match.index + match[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

const H2 = ({ children }: { children: ReactNode }) => (
  <h2 className="mt-10 border-b border-border pb-2 font-display text-2xl font-semibold text-brand-ink">
    {children}
  </h2>
)
const H3 = ({ children }: { children: ReactNode }) => (
  <h3 className="mt-6 text-lg font-semibold text-fg">{children}</h3>
)
const P = ({ children }: { children: ReactNode }) => (
  <p className="mt-2 leading-relaxed text-fg">{children}</p>
)
const Note = ({ children }: { children: ReactNode }) => (
  <p className="mt-2 text-sm leading-relaxed text-muted">{children}</p>
)

export function SeusDireitos() {
  const { messages } = useLocale()
  const m = messages.seusDireitos
  const todo = m.todoRotulo
  const ph = (s: string) => withPlaceholders(s, todo)

  return (
    <Container as="main" size="reading" className="py-10">
      <h1 className="font-display text-3xl font-semibold text-brand-ink">{m.titulo}</h1>

      <P>{ph(m.intro)}</P>

      {/* Quem é o titular: usuário com conta (A) × autor externo sem conta (B). */}
      <H3>{m.titularATitulo}</H3>
      <P>{ph(m.titularACorpo)}</P>
      <H3>{m.titularBTitulo}</H3>
      <P>{ph(m.titularBCorpo)}</P>

      {/* Fluxo do pedido (Art. 18/19; prazo de 15 dias). */}
      <H2>{m.fluxoTitulo}</H2>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 leading-relaxed text-fg">
        {m.fluxoPassos.map((passo, i) => (
          <li key={i}>{ph(passo)}</li>
        ))}
      </ol>
      <Note>{ph(m.prazoNota)}</Note>
      <Note>{ph(m.naoExigimosDocumentos)}</Note>

      {/* Canal de contato — encarregado + e-mail de privacidade reais (publicados). */}
      <H2>{m.canalTitulo}</H2>
      <P>{ph(m.canalCorpo)}</P>

      {/* Formulário público de intake (funcional): abre ticket + grava DSAR_RECEIVED. */}
      <H2>{m.formTitulo}</H2>
      <P>{ph(m.formIntro)}</P>
      <TakedownForm />

      {/* Rodapé de status da PÁGINA: versão / data / status = RASCUNHO. */}
      <footer className="mt-12 border-t border-border pt-4 text-sm text-muted">
        <p>
          <span className="font-medium text-fg">{m.rodapeVersaoRotulo}:</span>{' '}
          <span>{m.rodapeVersao}</span>
          {' · '}
          <span className="font-medium text-fg">{m.rodapeDataRotulo}:</span>{' '}
          <span>{m.rodapeData}</span>
        </p>
        <p className="mt-1">
          <span className="font-medium text-fg">{m.rodapeStatusRotulo}:</span>{' '}
          <span className="font-semibold text-aviso-fg">{m.rodapeStatus}</span>
        </p>
      </footer>
    </Container>
  )
}
