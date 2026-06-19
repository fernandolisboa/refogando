'use client'
/**
 * Afordâncias do detalhe da Receita (#61) — o cliente que decide, a partir da `RecipeView` que a
 * rota JÁ resolveu, QUAIS blocos de ação mostrar. Espelha o gate do servidor (NUNCA re-deriva
 * ownership no cliente):
 *
 *  - DONO (`view.canManage`): bloco de gestão = Editar/Apagar (`RecipeEditForm`) + Regenerar
 *    (`LineageVersionControls`, SÓ p/ Receita de IA `ai_*`) + o diff da derivada
 *    (`RecipeDiffView`, quando `view.derivedDiff` chega — owner-gated pelo servidor) com a nota
 *    de vínculo perdido. A Visibilidade (#59) continua na PAGE (irmã desta).
 *  - NÃO-DONO (catálogo / pública de outra pessoa): "Criar minha versão" (`DeriveExperience`).
 *    Gating #22 (descope): Visitante vê um CONVITE de entrar; logado vê o fluxo de derivar.
 *    Derivar a PRÓPRIA já é impossível aqui (o dono cai no ramo `canManage`).
 *
 * `canDerive`: catálogo (origin 'catalog') OU comunidade NÃO-própria. Como a rota só expõe
 * `visibility` ao dono, no não-dono usamos a presença do detalhe + a ausência de `canManage`:
 * uma Receita que o viewer está LENDO e NÃO gerencia é, por construção do gate de leitura,
 * pública/catálogo (privada de outro é 404 e nunca chega aqui). Logo qualquer leitura não-dono
 * é derivável.
 *
 * Sem `<h1>` (o `RecipeDetailView` emite o único `<h1>`). Tokens NEUTROS (ADR-0004).
 */
import { useSession } from '@/lib/auth-client'
import { useLocale } from '@/i18n/provider'
import Link from 'next/link'
import { btnPrimary } from '@/components/button'
import type { RecipeView } from '@/domain/recipe-read'
import { RecipeEditForm } from './recipe-edit-form'
import { LineageVersionControls } from './lineage-version-controls'
import { RecipeDiffView } from './recipe-diff-view'
import { DeriveExperience } from './derive-experience'

export function RecipeDetailActions({ view, locale }: { view: RecipeView; locale: string }) {
  const { messages } = useLocale()
  const session = useSession()
  const authed = !session.isPending && !session.error && !!session.data

  // ── DONO: gestão da própria Receita ─────────────────────────────────────────
  if (view.canManage) {
    // Regenerar só faz sentido em Receita de IA (ai_chat/ai_structured/ai_free_text); o servidor
    // 409a outras origens. A regenerabilidade é gateada DIRETO pelo grupo de origin `ai_*` (não
    // por `classifySection`, que só separa catálogo de comunidade): catalog/user_edited NÃO são
    // regeneráveis (ADR-0013).
    const isAi = view.origin.startsWith('ai_')
    return (
      <div className="flex flex-col gap-6">
        {/* Diff da derivada (owner-gated pelo servidor: derivedDiff só chega pro dono). */}
        {view.derivedDiff && (
          <RecipeDiffView diff={view.derivedDiff} vinculoPerdido={view.vinculoPerdido} />
        )}
        <RecipeEditForm view={view} />
        {isAi && <LineageVersionControls recipeId={view.id} />}
      </div>
    )
  }

  // ── NÃO-DONO: derivar (catálogo / pública de outra pessoa) ───────────────────
  // Guest (#22 descope): convite de entrar — sem fluxo de geração/cópia para anônimo.
  if (!authed) {
    // Enquanto a sessão resolve, nada pisca (evita flash do convite p/ um logado).
    if (session.isPending) return null
    return (
      <section
        aria-labelledby="convite-titulo"
        className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3"
      >
        <h2 id="convite-titulo" className="font-display text-lg font-semibold text-fg">
          {messages.minhasCriacoes.convidaEntrarTitulo}
        </h2>
        <p className="max-w-[60ch] text-sm text-muted">
          {messages.minhasCriacoes.convidaEntrarTexto}
        </p>
        <div>
          <Link href="/sign-in" className={btnPrimary}>
            {messages.nav.signIn}
          </Link>
        </div>
      </section>
    )
  }

  // Logado e não-dono: pode criar a própria versão (derivar). Toda leitura não-dono é
  // catálogo/pública por construção do gate (privada de outro é 404 e nunca chega aqui).
  return <DeriveExperience view={view} locale={locale} />
}
