'use client'
/**
 * Afordâncias do detalhe da Receita (#61) — o cliente que decide, a partir da `RecipeView` que a
 * rota JÁ resolveu, QUAIS blocos de ação mostrar. Espelha o gate do servidor (NUNCA re-deriva
 * ownership no cliente):
 *
 *  - DONO (`view.canManage`): bloco de gestão = Editar/Apagar (`RecipeEditModal`, #192) + Regenerar
 *    (`LineageVersionControls`, SÓ p/ Receita de IA `ai_*`) + o diff da derivada
 *    (`RecipeDiffView`, quando `view.derivedDiff` chega — owner-gated pelo servidor) com a nota
 *    de vínculo perdido. A Visibilidade (#59) continua na PAGE (irmã desta).
 *  - NÃO-DONO (catálogo / pública de outra pessoa): "Criar minha versão" — #196/ADR-0021 abre o
 *    MESMO modal compartilhado (`RecipeEditModal mode="derive"`), prefilled da base; o Salvar
 *    DERIVA (POST /derive — a base nunca é mutada) e navega pra nova Receita (sua, privada).
 *    Gating #22 (descope): Visitante vê um CONVITE de entrar; logado vê o gatilho de derivar.
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
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import type { RecipeView } from '@/domain/recipe-read'
import { RecipeEditModal } from './recipe-edit-modal'
import { LineageVersionControls } from './lineage-version-controls'
import { RecipeDiffView } from './recipe-diff-view'
import { ClearAttributionButton } from './clear-attribution-button'

export function RecipeDetailActions({ view, locale }: { view: RecipeView; locale: string }) {
  const { messages } = useLocale()
  const session = useSession()
  const authed = !session.isPending && !session.error && !!session.data
  const pathname = usePathname()
  const returnTo = pathname ?? '/'

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
        {/* #192/ADR-0021: editar a própria Receita é IN-PLACE num MODAL centrado (a tela de
            detalhe é só-leitura), não mais um form inline. O Apagar acompanha dentro do modal. */}
        <div>
          <RecipeEditModal view={view} />
        </div>
        {isAi && <LineageVersionControls recipeId={view.id} />}
        {/* #272 (LGPD): só aparece p/ importada da web com nome de fonte humano (self-gating). */}
        <ClearAttributionButton view={view} />
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
          <Button asChild>
            <Link href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>{messages.nav.signIn}</Link>
          </Button>
        </div>
      </section>
    )
  }

  // Logado e não-dono: pode criar a própria versão (derivar). #196/ADR-0021: o MESMO modal
  // compartilhado abre em `mode="derive"` — Salvar deriva (POST /derive) e navega pra nova
  // Receita. Toda leitura não-dono é catálogo/pública por construção do gate (privada de outro
  // é 404 e nunca chega aqui).
  return <RecipeEditModal view={view} mode="derive" locale={locale} />
}
