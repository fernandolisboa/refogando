'use client'
/**
 * Corpo dos Termos de Uso v1 (ADR-0051; parecer interno §7 e §8) — PUBLICADOS (indexáveis, linkados no
 * rodapé, no sitemap e na linha do cadastro).
 *
 * Client component (como o PrivacyPolicy) para acompanhar o locale na troca em runtime: todo o texto vem de
 * `messages.termos` (pt-BR é o texto aprovado; en-US, tradução fiel) — NADA hardcoded aqui. Sem chamadas de
 * dados. Versão nova entra em `s10Historico` + rodapé, e a mudança relevante pede o aviso no app 15 dias antes
 * (item 10; `AVISO_LEGAL_VERSAO` em `src/domain/legal-notice.ts`).
 *
 * Seções em `<h2>` (h1 → h2, sem pular nível), montadas por `sections(m)` para o JSX ter um laço só. As
 * cláusulas que limitam direito ou pedem atenção ficam em negrito (CDC art. 54, §§ 3º e 4º; o alerta de
 * alergênicos, art. 9º): o conjunto `DESTAQUES` decide quais, para as mensagens seguirem planas. As strings não
 * têm `{...}` (um teste de UI garante), então não há `withPlaceholders` aqui.
 */
import { Fragment, type ReactNode } from 'react'
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'
import type { Messages } from '@/i18n/messages'

type Termos = Messages['termos']

type Section = {
  /** Chave do corpo em `messages.termos` (ex.: `s5Corpo`), base do `DESTAQUES`. */
  corpoKey?: string
  titulo: string
  corpo?: readonly string[]
  itens?: readonly string[]
}

/**
 * Cláusulas em destaque, como `<chave do corpo>:<índice>`: alergênicos (4[0]), a licença, as cópias que ficam e o
 * conteúdo que fica após a eliminação (5[2–4]), as sanções (8[3]), os limites de responsabilidade (9[0–1]) e a
 * regra de mudança (10[0]). Mudou a ordem de um corpo? Revise este conjunto junto.
 */
const DESTAQUES: ReadonlySet<string> = new Set([
  's4Corpo:0',
  's5Corpo:2',
  's5Corpo:3',
  's5Corpo:4',
  's8Corpo:3',
  's9Corpo:0',
  's9Corpo:1',
  's10Corpo:0',
])

function sections(m: Termos): Section[] {
  return [
    { corpoKey: 's1Corpo', titulo: m.s1Titulo, corpo: m.s1Corpo },
    { corpoKey: 's2Corpo', titulo: m.s2Titulo, corpo: m.s2Corpo },
    { corpoKey: 's3Corpo', titulo: m.s3Titulo, corpo: m.s3Corpo },
    { corpoKey: 's4Corpo', titulo: m.s4Titulo, corpo: m.s4Corpo },
    { corpoKey: 's5Corpo', titulo: m.s5Titulo, corpo: m.s5Corpo },
    { corpoKey: 's6Corpo', titulo: m.s6Titulo, corpo: m.s6Corpo },
    { titulo: m.s7Titulo, itens: m.s7Itens },
    { corpoKey: 's8Corpo', titulo: m.s8Titulo, corpo: m.s8Corpo },
    { corpoKey: 's9Corpo', titulo: m.s9Titulo, corpo: m.s9Corpo },
    // Histórico de versões (a mais nova por último; o rodapé repete a última).
    { corpoKey: 's10Corpo', titulo: m.s10Titulo, corpo: m.s10Corpo, itens: m.s10Historico },
    { corpoKey: 's11Corpo', titulo: m.s11Titulo, corpo: m.s11Corpo },
  ]
}

// ── Blocos de apresentação (módulo-escopo; não recriados a cada render — react-hooks/static-components) ──

const H2 = ({ children }: { children: ReactNode }) => (
  <h2 className="mt-8 text-lg font-semibold text-fg">{children}</h2>
)
const P = ({ children, destaque = false }: { children: ReactNode; destaque?: boolean }) => (
  <p className={`mt-2 leading-relaxed text-fg${destaque ? ' font-semibold' : ''}`}>{children}</p>
)
const List = ({ items }: { items: readonly string[] }) => (
  <ul className="mt-3 list-disc space-y-1.5 pl-5 leading-relaxed text-fg">
    {items.map((it, i) => (
      <li key={i}>{it}</li>
    ))}
  </ul>
)

export function TermsOfUse() {
  const { messages } = useLocale()
  const m = messages.termos

  return (
    <Container as="main" size="reading" className="py-10">
      <h1 className="font-display text-3xl font-semibold text-brand-ink">{m.titulo}</h1>
      <p className="mt-2 leading-relaxed text-fg">{m.intro}</p>

      {sections(m).map((s) => (
        <Fragment key={s.titulo}>
          <H2>{s.titulo}</H2>
          {s.corpo?.map((paragraph, i) => (
            <P key={i} destaque={DESTAQUES.has(`${s.corpoKey}:${i}`)}>
              {paragraph}
            </P>
          ))}
          {s.itens && <List items={s.itens} />}
        </Fragment>
      ))}

      {/* Rodapé da PÁGINA: versão e data (a mesma da última linha do histórico). */}
      <footer className="mt-12 border-t border-border pt-4 text-sm text-muted">
        <p>
          <span className="font-medium text-fg">{m.rodapeVersaoRotulo}:</span> <span>{m.rodapeVersao}</span>
          {' · '}
          <span className="font-medium text-fg">{m.rodapeDataRotulo}:</span> <span>{m.rodapeData}</span>
        </p>
      </footer>
    </Container>
  )
}
