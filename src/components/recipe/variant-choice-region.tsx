'use client'
/**
 * Região de ESCOLHA da variação — "gerar 2, o usuário escolhe" (#423, ADR-0029 dec.6).
 *
 * Renderiza as DUAS variações lado a lado (`RecipeDetailView` reusada, com o nome em `h2` — a região
 * não introduz um 2º `<h1>`), cada uma com um CTA "escolher esta". Ao picar, chama `onEscolher(v)`, que
 * no motor (`useRecipeGeneration.escolherVariante`) registra a escolha (SERVER-AUTHORITATIVE, owner-scope)
 * e CONVERGE para `GenerationResultRegion` (mostra a escolhida como um resultado normal). AMBAS as
 * receitas já nasceram PRIVADAS; a NÃO-escolhida permanece no espaço do usuário (aceitável — não a
 * escondemos nesta fatia). Botões travam após o 1º clique (anti-duplicação).
 *
 * Aviso de restrição (ADR-0004): via `RecipeDetailView`/`view.avisos` (âmbar), por coluna. Se o corpo de
 * uma variação não carregou (`view == null`), a coluna degrada para uma nota neutra — a receita está
 * salva e continua escolhível (o motor converge para o estado "criada, mas não carregou").
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Messages } from '@/i18n/messages'
import { RecipeDetailView } from './recipe-detail-view'
import { PortionScaleProvider } from './recipe-portion-scale-context'
import { useCozinhaVocab } from '@/components/i18n/cozinha-vocab-provider'
import { resolveCozinhaLabel } from '@/domain/cozinha-label'
import type { VariantChoice } from '@/hooks/use-recipe-generation'

export function VariantChoiceRegion({
  variants,
  messages,
  locale,
  onEscolher,
}: {
  variants: VariantChoice[]
  messages: Messages
  locale: string
  /** Registra a escolha e converge para o resultado da escolhida (via o motor de geração). */
  onEscolher: (v: VariantChoice) => void
}) {
  const m = messages.criar
  const cozinhaVocab = useCozinhaVocab()
  // Trava o par de botões após o 1º clique (a convergência é assíncrona — evita escolher as duas).
  const [picking, setPicking] = useState(false)

  function escolher(v: VariantChoice) {
    if (picking) return
    setPicking(true)
    onEscolher(v)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
          {m.variacaoTitulo}
        </h2>
        <p className="max-w-[60ch] text-muted">{m.variacaoIntro}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {variants.map((v, i) => (
          <section
            key={v.generationId}
            aria-label={m.variacaoColuna.replace('{n}', String(i + 1))}
            className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
          >
            <div className="flex flex-col gap-1">
              <span className="text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-brand-ink">
                {m.variacaoColuna.replace('{n}', String(i + 1))}
              </span>
              {v.label.trim() !== '' && <span className="text-sm font-medium text-fg">{v.label}</span>}
            </div>

            {v.view != null ? (
              // #453: cada coluna ganha o SEU PRÓPRIO `PortionScaleProvider` (não compartilhado
              // entre as duas variações) — escala independente por coluna, espelhando o
              // comportamento de antes (cada `RecipePortionScaler` tinha seu `useState` próprio).
              <PortionScaleProvider originalPorcoes={v.view.porcoes ?? 1}>
                <RecipeDetailView
                  view={v.view}
                  m={messages}
                  locale={locale}
                  nameHeadingLevel="h2"
                  cozinhaLabel={resolveCozinhaLabel(cozinhaVocab, v.view.facets.cozinha)}
                />
              </PortionScaleProvider>
            ) : (
              <p className="text-muted">{m.variacaoCorpoIndisponivel}</p>
            )}

            <div>
              <Button
                type="button"
                onClick={() => escolher(v)}
                disabled={picking}
                aria-busy={picking || undefined}
              >
                {m.variacaoEscolher}
              </Button>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
