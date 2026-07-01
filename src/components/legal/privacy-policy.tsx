'use client'
/**
 * Corpo da Política de Privacidade (#398 / #276) — RASCUNHO jurídico renderizado numa rota GATED.
 *
 * Client component (como o SiteFooter) para acompanhar o locale na troca em runtime: todo o texto vem
 * de `messages.privacidade` (i18n bilíngue pt-BR/en-US) — NADA hardcoded aqui. Sem chamadas de dados.
 *
 * GATED, de propósito: esta página NÃO é linkada em header/footer/nav e a rota é `noindex` + fora do
 * sitemap (ver `page.tsx`). Ela existe mas não é anunciada. Para PUBLICAR é preciso, em conjunto:
 *   (1) preencher os placeholders `{...}` (razão social, CNPJ, e-mail do encarregado…);
 *   (2) obter o sign-off jurídico da #276 (base legal, transferência internacional, retenção, controlador);
 *   (3) existir de fato o canal de takedown/encarregado antes de anunciá-lo (Parte b.5);
 *   (4) só então adicionar o link no rodapé + remover o `noindex`.
 *
 * Os placeholders `{...}` NUNCA saem como texto "final": `withPlaceholders` os troca por um BADGE de TODO
 * visível (`<mark data-todo>`), para o leitor ver de imediato que o campo está por preencher. Um teste de
 * UI garante que nenhum `{`/`}` sobra no texto renderizado.
 */
import type { ReactNode } from 'react'
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'

/**
 * Substitui cada placeholder `{...}` por um badge de TODO visível. Strings sem placeholder passam
 * intactas — então aplicar a TODO folha de texto é seguro (idempotente) e fecha o buraco de "texto
 * final com chaves publicado por engano".
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

// ── Blocos de apresentação (módulo-escopo; não recriados a cada render — react-hooks/static-components) ──

const H2 = ({ children }: { children: ReactNode }) => (
  <h2 className="mt-10 border-b border-border pb-2 font-display text-2xl font-semibold text-brand-ink">
    {children}
  </h2>
)
const H3 = ({ children }: { children: ReactNode }) => (
  <h3 className="mt-6 text-lg font-semibold text-fg">{children}</h3>
)
const H4 = ({ children }: { children: ReactNode }) => (
  <h4 className="mt-5 font-medium text-fg">{children}</h4>
)
const P = ({ children }: { children: ReactNode }) => (
  <p className="mt-2 leading-relaxed text-fg">{children}</p>
)
const Note = ({ children }: { children: ReactNode }) => (
  <p className="mt-2 text-sm leading-relaxed text-muted">{children}</p>
)

// Bloco de alerta (âmbar do design system): aviso de RASCUNHO e GAPs/PENDÊNCIAS. `children` já vem
// renderizado pelo chamador (com placeholders resolvidos), então este bloco é um passthrough puro.
const Aviso = ({ label, children }: { label?: string; children: ReactNode }) => (
  <div
    role="note"
    className="mt-3 rounded-md border border-aviso-fg/40 bg-aviso-bg px-4 py-3 text-sm leading-relaxed text-aviso-fg"
  >
    {label ? <span className="font-semibold">{label}: </span> : null}
    {children}
  </div>
)

const List = ({
  items,
  todoLabel,
  ordered = false,
}: {
  items: readonly string[]
  todoLabel: string
  ordered?: boolean
}) => {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag
      className={`mt-3 space-y-1.5 pl-5 leading-relaxed text-fg ${ordered ? 'list-decimal' : 'list-disc'}`}
    >
      {items.map((it, i) => (
        <li key={i}>{withPlaceholders(it, todoLabel)}</li>
      ))}
    </Tag>
  )
}

// Ficha Dados/Finalidade/Base legal/Retenção (itens 3.x e b.3): rótulos + valores por índice.
const Ficha = ({
  labels,
  values,
  todoLabel,
}: {
  labels: readonly string[]
  values: readonly string[]
  todoLabel: string
}) => (
  <dl className="mt-3 grid gap-2">
    {labels.map((label, i) => (
      <div key={i} className="grid gap-0.5 sm:grid-cols-[11rem_1fr] sm:gap-4">
        <dt className="font-medium text-fg">{label}</dt>
        <dd className="leading-relaxed text-fg">{withPlaceholders(values[i] ?? '', todoLabel)}</dd>
      </div>
    ))}
  </dl>
)

export function PrivacyPolicy() {
  const { messages } = useLocale()
  const m = messages.privacidade
  const todo = m.todoRotulo
  // Aplica o parser de placeholders a QUALQUER folha de texto (seguro para strings sem `{...}`).
  const ph = (s: string) => withPlaceholders(s, todo)
  const defLabels = [m.rotuloDados, m.rotuloFinalidade, m.rotuloBaseLegal, m.rotuloRetencao]

  return (
    <Container as="main" size="reading" className="py-10">
      <h1 className="font-display text-3xl font-semibold text-brand-ink">{m.titulo}</h1>

      {/* Aviso de RASCUNHO — o texto não é parecer nem está publicado. */}
      <Aviso>{ph(m.rascunhoAviso)}</Aviso>

      {/* ───────────────────────── Parte (a) ───────────────────────── */}
      <H2>{m.parteATitulo}</H2>

      <section className="mt-4 rounded-md border border-border bg-surface px-4 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{m.resumoTitulo}</h3>
        <List items={m.resumoItens} todoLabel={todo} />
      </section>

      <H3>{m.s1Titulo}</H3>
      {m.s1Corpo.map((paragraph, i) => (
        <P key={i}>{ph(paragraph)}</P>
      ))}

      <H3>{m.s2Titulo}</H3>
      <List items={m.s2Itens} todoLabel={todo} />
      <Aviso label={m.gapRotulo}>{ph(m.s2Gap)}</Aviso>

      <H3>{m.s3Titulo}</H3>
      <P>{ph(m.s3Intro)}</P>
      <Note>{ph(m.s3Nota)}</Note>

      <H4>{m.s31Titulo}</H4>
      <Ficha labels={defLabels} values={m.s31Valores} todoLabel={todo} />
      <H4>{m.s32Titulo}</H4>
      <Ficha labels={defLabels} values={m.s32Valores} todoLabel={todo} />
      <H4>{m.s33Titulo}</H4>
      <Ficha labels={defLabels} values={m.s33Valores} todoLabel={todo} />
      <H4>{m.s34Titulo}</H4>
      <P>{ph(m.s34Corpo)}</P>

      <H3>{m.s4Titulo}</H3>
      <List items={m.s4Itens} todoLabel={todo} />

      <H3>{m.s5Titulo}</H3>
      <P>{ph(m.s5Intro)}</P>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              {m.s5Cabecalho.map((h, i) => (
                <th key={i} className="py-2 pr-4 font-semibold text-fg">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.s5Prestadores.map((provider, i) => (
              <tr key={i} className="border-b border-border/60">
                <td className="py-2 pr-4 font-medium text-fg">{provider}</td>
                <td className="py-2 pr-4 text-fg">{m.s5ParaQue[i]}</td>
                <td className="py-2 pr-4 text-fg">{m.s5Categorias[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Note>{ph(m.s5Nota)}</Note>
      <Aviso label={m.gapRotulo}>{ph(m.s5Transferencia)}</Aviso>

      <H3>{m.s6Titulo}</H3>
      <List items={m.s6Itens} todoLabel={todo} />

      <H3>{m.s7Titulo}</H3>
      <P>{ph(m.s7Intro)}</P>
      <List items={m.s7Direitos} todoLabel={todo} ordered />
      <P>{ph(m.s7ComoExercer)}</P>
      <Aviso label={m.gapRotulo}>{ph(m.s7Gap)}</Aviso>

      <H3>{m.s8Titulo}</H3>
      <P>{ph(m.s8Corpo)}</P>

      {/* ───────────────────────── Parte (b) ───────────────────────── */}
      <H2>{m.parteBTitulo}</H2>

      <section className="mt-4 rounded-md border border-border bg-surface px-4 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{m.resumoBTitulo}</h3>
        <List items={m.resumoBItens} todoLabel={todo} />
      </section>

      <H3>{m.b1Titulo}</H3>
      {m.b1Corpo.map((paragraph, i) => (
        <P key={i}>{ph(paragraph)}</P>
      ))}
      <List items={m.b1Itens} todoLabel={todo} />

      <H3>{m.b2Titulo}</H3>
      <P>{ph(m.b2Corpo)}</P>

      <H3>{m.b3Titulo}</H3>
      <Ficha labels={m.b3Rotulos} values={m.b3Valores} todoLabel={todo} />

      <H3>{m.b4Titulo}</H3>
      <P>{ph(m.b4Corpo)}</P>

      <H3>{m.b5Titulo}</H3>
      <P>{ph(m.b5Intro)}</P>
      {/* AC #5: NÃO anunciar um canal de takedown que ainda não existe — a pendência é declarada em alto
          relevo e o contato é um placeholder (não uma promessa de canal ativo). */}
      <Aviso label={m.gapRotulo}>{ph(m.b5Gap)}</Aviso>
      <List items={m.b5ComoFunciona} todoLabel={todo} />
      <P>{ph(m.b5Contato)}</P>

      {/* Rodapé de status da PÁGINA (AC #4): versão / data / status = RASCUNHO. */}
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
