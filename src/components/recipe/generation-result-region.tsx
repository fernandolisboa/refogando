'use client'
/**
 * Região de RESULTADO compartilhada da geração de Receita (#193, extraída do
 * `create-structured-experience.tsx`). Renderiza, a partir do "bag" do `useRecipeGeneration`, o
 * desfecho da geração: impossible (hard-stop honesto, sem Receita), load-failed (criada mas o GET
 * falhou → recarregar, NUNCA reenviar = duplicação), e success/degraded/playful com a Receita
 * (`RecipeDetailView` — o `<h1>` do nome é o ÚNICO do documento) + advisory + CTAs.
 *
 * Aviso de restrição (ADR-0004): só via `RecipeDetailView`/`RestrictionWarning` a partir de
 * `view.avisos` (âmbar). Banners de desfecho são NEUTROS (âmbar é EXCLUSIVO do Aviso de restrição).
 *
 * Reusado pela /create estruturada/prompt-aberto e pelo wizard estruturado do drawer. A região
 * `aria-live` PRÉ-existe no caller (que pendura o `headingRef` no heading do topo); aqui só vai o
 * conteúdo que entra/sai.
 */
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { Messages } from '@/i18n/messages'
import type { RecipeView } from '@/domain/recipe-read'
import { RecipeDetailView } from './recipe-detail-view'
import { recipeDetailPath } from '@/domain/recipe-detail-route'
import { useCozinhaVocab } from '@/components/i18n/cozinha-vocab-provider'
import { resolveCozinhaLabel } from '@/domain/cozinha-label'
import type { GenerationResult } from '@/hooks/use-recipe-generation'

export function GenerationResultRegion({
  result,
  view,
  loadFailed,
  messages,
  locale,
  onRecarregar,
  onTentarNovamente,
  onCriarOutra,
}: {
  result: GenerationResult
  view: RecipeView | null
  loadFailed: boolean
  messages: Messages
  /**
   * #231 (ADR-0020): locale corrente (UI), fallback do segmento `[locale]` quando o 201 não devolveu
   * `result.locale` (slug ausente). Com slug, o segmento é `result.locale` (o locale do slug congelado).
   */
  locale: string
  /** Re-busca o corpo da Receita JÁ criada (load-failed). */
  onRecarregar: () => void
  /** Volta ao formulário SEM limpar (impossible → "ajustar e tentar de novo"). */
  onTentarNovamente: () => void
  /** Volta ao formulário LIMPANDO os campos ("criar outra receita"). */
  onCriarOutra: () => void
}) {
  const m = messages.criar
  // #317: rótulo de cozinha do leitor data-driven (contexto ATIVO do layout) — uma receita
  // recém-gerada tem necessariamente cozinha ativa; ausente do escopo cai no próprio slug.
  const cozinhaVocab = useCozinhaVocab()

  if (result.outcome === 'impossible') {
    // 'impossible' de verdade: nenhuma Receita foi criada.
    return (
      <>
        <p className="text-fg">{m.resultadoImpossivel}</p>
        {result.advisory && <p className="max-w-[60ch] text-muted">{result.advisory}</p>}
        <div>
          <Button type="button" variant="secondary" onClick={onTentarNovamente}>
            {m.tentarNovamente}
          </Button>
        </div>
      </>
    )
  }

  if (loadFailed || view == null) {
    // A Receita FOI criada (success/degraded/playful) mas o GET do corpo falhou. NÃO dizer
    // 'impossível' (o usuário reenviaria e DUPLICARIA a geração). Oferecer recarregar.
    return (
      <>
        <p className="text-fg">{m.erroCarregarReceita}</p>
        {result.advisory && <p className="max-w-[60ch] text-muted">{result.advisory}</p>}
        <div>
          <Button type="button" variant="secondary" onClick={onRecarregar}>
            {m.tentarCarregarNovamente}
          </Button>
        </div>
      </>
    )
  }

  return (
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

      {/* A Receita — REUSO total. O `<h1>{view.name}` aqui é o ÚNICO `<h1>`. */}
      <RecipeDetailView
        view={view}
        m={messages}
        cozinhaLabel={resolveCozinhaLabel(cozinhaVocab, view.facets.cozinha)}
      />

      <div className="flex flex-wrap items-center gap-3">
        {/* A Receita JÁ está persistida (private). "Ver receita" só NAVEGA pro detalhe (#59),
            onde moram os controles de Visibilidade — não escreve nada. */}
        {result.recipeId && (
          <Button asChild>
            {/* #231 (ADR-0020): canônico `/{locale}/recipes/<slug>` no locale do slug congelado; sem
                slug cai no fallback `/{locale}/recipes/<uuid>` (que 308a). Nunca link nu sem locale. */}
            <Link href={recipeDetailPath(result.locale ?? locale, result.slug ?? result.recipeId)}>
              {m.verReceita}
            </Link>
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={onCriarOutra}>
          {m.criarOutra}
        </Button>
      </div>
    </>
  )
}
