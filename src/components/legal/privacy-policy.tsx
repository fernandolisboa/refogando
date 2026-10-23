'use client'
/**
 * Corpo da Política de Privacidade (#398 / parte de #276) — PUBLICADA (indexável, linkada no rodapé).
 *
 * Client component (como o SiteFooter) para acompanhar o locale na troca em runtime: todo o texto vem
 * de `messages.privacidade` (i18n bilíngue pt-BR/en-US) — NADA hardcoded aqui. Sem chamadas de dados.
 *
 * Revisada no parecer interno de 2026-10-22 (`docs/legal/parecer-interno-2026-10-22.md`), que fechou o
 * #276 (v3). Os contatos reais estão escritos DIRETO nas strings i18n (`messages.privacidade`) — editar
 * ali é como o dono troca o e-mail do canal. Versão nova entra em `s10Historico` + rodapé.
 *
 * `withPlaceholders` é mantido como rede de segurança: se algum `{...}` reaparecer numa string, ele o
 * troca por um BADGE visível (`<mark data-todo>`) em vez de publicar chaves cruas. Hoje as strings não
 * têm placeholders, então ele é um passthrough; um teste de UI garante que nenhum `{`/`}` sobra no render.
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

// Tabela de colunas paralelas (prestadores do item 5, cookies do item 8): a linha i junta `colunas[c][i]`.
// A 1ª coluna nomeia a linha (`<th scope="row">`, em destaque) e o cabeçalho nomeia as colunas
// (`scope="col"`): o leitor de tela anuncia "Proton, Para quê: …". As colunas têm o mesmo tamanho (o teste
// de UI trava). Toda célula passa por `withPlaceholders`, como o resto da página.
const Tabela = ({
  cabecalho,
  colunas,
  todoLabel,
}: {
  cabecalho: readonly string[]
  colunas: readonly (readonly string[])[]
  todoLabel: string
}) => (
  <div className="mt-3 overflow-x-auto">
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-border">
          {cabecalho.map((h, i) => (
            <th key={i} scope="col" className="py-2 pr-4 font-semibold text-fg">
              {withPlaceholders(h, todoLabel)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {(colunas[0] ?? []).map((_, row) => (
          <tr key={row} className="border-b border-border/60">
            {colunas.map((col, c) =>
              c === 0 ? (
                <th key={c} scope="row" className="py-2 pr-4 font-medium text-fg">
                  {withPlaceholders(col[row] ?? '', todoLabel)}
                </th>
              ) : (
                <td key={c} className="py-2 pr-4 text-fg">
                  {withPlaceholders(col[row] ?? '', todoLabel)}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

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
      <H4>{m.s35Titulo}</H4>
      <Ficha labels={defLabels} values={m.s35Valores} todoLabel={todo} />
      <H4>{m.s36Titulo}</H4>
      <Ficha labels={defLabels} values={m.s36Valores} todoLabel={todo} />
      <H4>{m.s37Titulo}</H4>
      <Ficha labels={defLabels} values={m.s37Valores} todoLabel={todo} />
      <H4>{m.s38Titulo}</H4>
      <Ficha labels={defLabels} values={m.s38Valores} todoLabel={todo} />
      <H4>{m.s39Titulo}</H4>
      <Ficha labels={defLabels} values={m.s39Valores} todoLabel={todo} />

      <H3>{m.s4Titulo}</H3>
      <List items={m.s4Itens} todoLabel={todo} />

      <H3>{m.s5Titulo}</H3>
      <P>{ph(m.s5Intro)}</P>
      <Tabela
        cabecalho={m.s5Cabecalho}
        colunas={[m.s5Prestadores, m.s5ParaQue, m.s5Categorias]}
        todoLabel={todo}
      />
      <Note>{ph(m.s5Nota)}</Note>
      <Note>{ph(m.s5Transferencia)}</Note>

      <H3>{m.s6Titulo}</H3>
      <List items={m.s6Itens} todoLabel={todo} />

      <H3>{m.s7Titulo}</H3>
      <P>{ph(m.s7Intro)}</P>
      <List items={m.s7Direitos} todoLabel={todo} ordered />
      <P>{ph(m.s7ComoExercer)}</P>

      <H3>{m.s8Titulo}</H3>
      <P>{ph(m.s8Intro)}</P>
      <Tabela cabecalho={m.s8Cabecalho} colunas={[m.s8Nomes, m.s8ParaQue, m.s8Duracoes]} todoLabel={todo} />

      {/* v3.1 (ADR-0051): idade mínima de 16 anos, a mesma dos Termos de Uso. */}
      <H3>{m.s9Titulo}</H3>
      <P>{ph(m.s9Corpo)}</P>

      <H3>{m.s10Titulo}</H3>
      <P>{ph(m.s10Corpo)}</P>
      {/* Histórico de versões (a mais nova por último; o rodapé repete a última). */}
      <List items={m.s10Historico} todoLabel={todo} />

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
      <List items={m.b5ComoFunciona} todoLabel={todo} />
      <P>{ph(m.b5Contato)}</P>

      {/* Rodapé de status da PÁGINA (AC #4): versão / data / status da revisão. */}
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
          <span className="font-semibold text-fg">{m.rodapeStatus}</span>
        </p>
      </footer>
    </Container>
  )
}
