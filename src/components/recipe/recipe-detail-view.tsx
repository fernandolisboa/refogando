/**
 * Detalhe da Receita (#57) — componente PURO da leitura localizada. SEM hooks de
 * fetch/locale: recebe `view: RecipeView` (a rota JÁ resolveu nome/corpo/avisos/stale no
 * locale pedido — ADR-0010, a UI não reimplementa domínio) + `m: Messages` (rótulos já
 * localizados). É o nó testável isolado no jsdom.
 *
 * "Tela limpa" (#316): cada bloco de sinalização (stale/avisos) e cada faceta nula
 * (porções/dificuldade ausentes, restrições/tags vazias) é OMITIDO via `&&`/`!= null` —
 * nada de chrome vazio. `avisos`/`staleNotice`/`facets.restricoes` chegam AUSENTES quando
 * vazios direto da rota.
 *
 * A11y: um único `<h1>` (título); sub-seções com `<h2>`. Selo de proveniência REUSA
 * `ProvenanceBadge` (#56) — `classifySection(origin)` decide a regra visual; os rótulos
 * vêm de `busca.seloCatalogo/seloComunidade` (mesmo conceito, não duplicar em `detalhe`).
 * Cores: só tokens já AA-verificados na #54.
 */
import { classifySection, type SearchSection } from '@/domain/recipe'
import type { IngredientView, RecipeView } from '@/domain/recipe-read'
import { isCategoria, isCozinha, isRestricao, isUnidade } from '@/domain/vocabulary'
import type { Messages } from '@/i18n/messages'
import { ProvenanceBadge } from './provenance-badge'
import { RestrictionWarning } from './restriction-warning'
import { StaleNoticeBanner } from './stale-notice-banner'

/**
 * Classe-base dos chips de faceta (restrições/tags) — espelha o padrão `BASE` de
 * `provenance-badge.tsx`. SEM `rounded-*`: a forma varia por tipo (restrição
 * `rounded-full` vs tag `rounded-sm`) para distinguir os dois conceitos sem cor nova.
 */
const CHIP_BASE =
  'inline-flex items-center border border-border bg-surface px-2 py-0.5 text-xs font-medium text-muted'

/**
 * Normaliza a `quantidade` (string do `numeric(10,3)`, ex. `'2.500'`) tirando zeros à
 * direita: `'2.500'`→`'2.5'`, `'3.000'`→`'3'`. Valores que não convertem em número
 * (livre/inesperado) caem no original — nunca vira `NaN` na tela.
 */
function formatQuantidade(quantidade: string): string {
  const n = Number(quantidade)
  return Number.isFinite(n) ? String(n) : quantidade
}

/**
 * Localiza a unidade do enum `UNIDADES` (tokens machine-readable: `colher_de_sopa`,
 * `a_gosto`, …) via `m.unidadeLabel`. Valor fora do enum (defensivo) sai cru.
 */
function formatUnidade(unidade: string, m: Messages): string {
  return isUnidade(unidade) ? m.unidadeLabel[unidade] : unidade
}

/** Junta as partes não-nulas de um ingrediente numa linha legível: `qtd unidade — texto`. */
function formatIngredient(item: IngredientView, m: Messages): string {
  const quantidade = item.quantidade != null && item.quantidade !== '' ? formatQuantidade(item.quantidade) : null
  const unidade = item.unidade != null && item.unidade !== '' ? formatUnidade(item.unidade, m) : null
  const medida = [quantidade, unidade].filter((p) => p != null && p !== '').join(' ')
  if (medida && item.rawText) return `${medida} — ${item.rawText}`
  return medida || item.rawText || ''
}

export function RecipeDetailView({ view, m }: { view: RecipeView; m: Messages }) {
  const section: SearchSection = classifySection(view.origin)
  const badgeLabel = section === 'catalogo' ? m.busca.seloCatalogo : m.busca.seloComunidade

  // Cozinha/categoria são `string | null` (tipo largo) mas as colunas são enums PG —
  // estreita com os type-guards (sem `as`); `?? valor` é defensivo p/ valor fora do enum.
  const cozinha = view.facets.cozinha
  const cozinhaLabel = cozinha == null ? null : isCozinha(cozinha) ? m.cozinhaLabel[cozinha] : cozinha
  const categoria = view.facets.categoria
  const categoriaLabel =
    categoria == null ? null : isCategoria(categoria) ? m.categoriaLabel[categoria] : categoria

  // Ingredientes vêm ordenados por `ordem`; mantemos robusto com um sort estável (cópia).
  // Já formata cada linha e DESCARTA itens vazios (qtd/unidade/rawText todos nulos →
  // linha vazia, que renderizaria um marcador de lista solto). Mantém `ordem` p/ a key.
  const ingredientLines = [...view.ingredients]
    .sort((a, b) => a.ordem - b.ordem)
    .map((item) => ({ ordem: item.ordem, text: formatIngredient(item, m) }))
    .filter((line) => line.text !== '')

  const hasScalars =
    view.porcoes != null ||
    view.dificuldade != null ||
    cozinhaLabel != null ||
    categoriaLabel != null
  const restricoes = view.facets.restricoes
  const tags = view.facets.tags

  return (
    <article className="flex flex-col gap-8">
      {/* Cabeçalho: selo de proveniência + título (já vem PRONTO da rota). */}
      <header className="flex flex-col gap-3">
        <ProvenanceBadge variant={section} label={badgeLabel} />
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {view.name}
        </h1>
      </header>

      {/* Nota de tradução obsoleta — só quando a rota a anexa (stale e ≠ origem). */}
      {view.staleNotice && (
        <StaleNoticeBanner notice={view.staleNotice} recipeId={view.id} />
      )}

      {/* Avisos de contradição de restrição — só quando há ≥ 1 (âmbar; toque leve). */}
      {view.avisos && view.avisos.length > 0 && (
        <div className="flex flex-col gap-3">
          {view.avisos.map((aviso, i) => (
            <RestrictionWarning key={i} aviso={aviso} title={m.detalhe.avisoTitulo} />
          ))}
        </div>
      )}

      {/* Metadados escalares (porções/dificuldade/cozinha/categoria) → <dl>. Cada par é
          omitido quando nulo (tela limpa). O <dl> inteiro some quando não há escalar. */}
      {hasScalars && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm sm:grid-cols-[repeat(2,auto_1fr)] sm:gap-x-8">
          {view.porcoes != null && (
            <>
              <dt className="font-medium text-muted">{m.detalhe.porcoes}</dt>
              <dd className="text-fg">{view.porcoes}</dd>
            </>
          )}
          {view.dificuldade != null && (
            <>
              <dt className="font-medium text-muted">{m.detalhe.dificuldade}</dt>
              {/* Faixa canônica 1–5 (vocabulary.ts): denominador fixo `/5` desambigua o
                  inteiro cru (não há rótulo por nível de dificuldade). */}
              <dd className="text-fg">{view.dificuldade}/5</dd>
            </>
          )}
          {cozinhaLabel != null && (
            <>
              <dt className="font-medium text-muted">{m.detalhe.cozinha}</dt>
              <dd className="text-fg">{cozinhaLabel}</dd>
            </>
          )}
          {categoriaLabel != null && (
            <>
              <dt className="font-medium text-muted">{m.detalhe.categoria}</dt>
              <dd className="text-fg">{categoriaLabel}</dd>
            </>
          )}
        </dl>
      )}

      {/* Restrições declaradas → chips NEUTROS (declarada ≠ aviso âmbar). Grupo rotulado
          por <p> (NÃO <h2>: rótulo de grupo de chips não é seção de leitura — manter a
          árvore de headings só com as 4 seções de conteúdo). Forma `rounded-full` distingue
          restrição (semântica de dieta) da tag livre (`rounded-sm`), sem cor nova. */}
      {restricoes && restricoes.length > 0 && (
        <section aria-labelledby="restricoes-label" className="flex flex-col gap-2">
          <p id="restricoes-label" className="text-sm font-medium text-muted">
            {m.detalhe.restricoes}
          </p>
          <ul role="list" className="flex flex-wrap gap-2">
            {restricoes.map((r) => (
              <li key={r} className={`${CHIP_BASE} rounded-full`}>
                {isRestricao(r) ? m.restricaoLabel[r] : r}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Tags → chips neutros `rounded-sm` (distintos das restrições `rounded-full`). */}
      {tags.length > 0 && (
        <section aria-labelledby="tags-label" className="flex flex-col gap-2">
          <p id="tags-label" className="text-sm font-medium text-muted">
            {m.detalhe.tags}
          </p>
          <ul role="list" className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <li key={t} className={`${CHIP_BASE} rounded-sm`}>
                {t}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Descrição — só quando presente. Medida limitada (~68ch) p/ leitura confortável. */}
      {view.body.descricao && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-semibold text-fg">{m.detalhe.descricao}</h2>
          <p className="max-w-[68ch] text-pretty text-fg">{view.body.descricao}</p>
        </section>
      )}

      {/* Ingredientes — só quando há ≥ 1 linha não-vazia. */}
      {ingredientLines.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-semibold text-fg">{m.detalhe.ingredientes}</h2>
          <ul role="list" className="flex max-w-[68ch] flex-col gap-1.5 text-fg">
            {ingredientLines.map((line) => (
              <li key={line.ordem}>{line.text}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Modo de preparo — só quando há passos. */}
      {view.body.passos && view.body.passos.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-semibold text-fg">{m.detalhe.passos}</h2>
          <ol className="flex max-w-[68ch] list-decimal flex-col gap-2 pl-5 text-fg">
            {view.body.passos.map((passo, i) => (
              <li key={i} className="text-pretty pl-1">
                {passo}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Notas — só quando presente. */}
      {view.body.notas && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-semibold text-fg">{m.detalhe.notas}</h2>
          <p className="max-w-[68ch] text-pretty text-fg">{view.body.notas}</p>
        </section>
      )}
    </article>
  )
}
