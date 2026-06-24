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
 *
 * Ordem ESTILO INSTAGRAM (#161, topo→baixo): FOTO em destaque → título (+selo discreto
 * "tradução automática" guiado SÓ pela proveniência, via `view.autoTranslationSignal`) →
 * descrição → ingredientes → passos → notas → (metadados/restrições/tags) → crédito
 * "por <name>" MENOR ao FINAL. A foto e a legenda ficam em foco; o crédito fecha a leitura.
 */
import Link from 'next/link'
import { classifySection, type SearchSection } from '@/domain/recipe'
import type { IngredientView, RecipeView } from '@/domain/recipe-read'
import { isCategoria, isCozinha, isRestricao, isUnidade } from '@/domain/vocabulary'
import { formatDuracao } from '@/domain/tempo'
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

/**
 * Nome de exibição da FONTE (#169, ADR-0019): o `source.name` (publisher legível) quando há; senão
 * o HOST da URL sem o prefixo `www.` (ex. `panelinha.com.br`). Defensivo: URL inválida (não deveria
 * — a rota só importa http(s)) cai na própria string crua, nunca quebra a tela.
 */
function sourceDisplayName(source: { url: string; name?: string }): string {
  if (source.name != null && source.name !== '') return source.name
  try {
    return new URL(source.url).hostname.replace(/^www\./, '')
  } catch {
    return source.url
  }
}

/** Junta as partes não-nulas de um ingrediente numa linha legível: `qtd unidade — texto`. */
function formatIngredient(item: IngredientView, m: Messages): string {
  const quantidade = item.quantidade != null && item.quantidade !== '' ? formatQuantidade(item.quantidade) : null
  const unidade = item.unidade != null && item.unidade !== '' ? formatUnidade(item.unidade, m) : null
  const medida = [quantidade, unidade].filter((p) => p != null && p !== '').join(' ')
  if (medida && item.rawText) return `${medida} — ${item.rawText}`
  return medida || item.rawText || ''
}

export function RecipeDetailView({
  view,
  m,
  catalogDisclosure,
}: {
  view: RecipeView
  m: Messages
  /**
   * #237 (aviso de catálogo AI-assistido, SEO #187): TEXTO já resolvido do aviso editorial — presente
   * SÓ quando a página decidiu mostrá-lo (`shouldShowCatalogDisclosure`: receita de CATÁLOGO E config
   * LIGADA). AUSENTE em qualquer outro caso ("ausente ≠ vazio"). O componente é PURO: ele NÃO re-decide
   * a regra (a decisão vive no domínio + página) — só renderiza a frase quando a recebe.
   *
   * INEGOCIÁVEL: é uma CORTESIA editorial ADITIVA. NÃO substitui nem oculta os selos OBRIGATÓRIOS de
   * proveniência — o `ProvenanceBadge` (selo de origem) e o selo "✨ gerada por IA" (`imageAiGenerated`)
   * são renderizados em caminhos SEPARADOS abaixo, independentes deste prop (ligado OU desligado).
   */
  catalogDisclosure?: string
}) {
  // #169/ADR-0019: a IMPORTADA da web ganha um selo de proveniência PRÓPRIO ("Importada da web"),
  // distinto de Catálogo/Comunidade — não é conteúdo do pool, é cópia privada creditada à fonte. A
  // variante visual reusa `comunidade` (neutra) na primitiva (sem cor nova); só o RÓTULO muda.
  const section: SearchSection = classifySection(view.origin)
  const isImported = view.origin === 'web_imported'
  const badgeLabel = isImported
    ? m.busca.seloImportada
    : section === 'catalogo'
      ? m.busca.seloCatalogo
      : m.busca.seloComunidade

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
    view.tempoTotalMin != null ||
    cozinhaLabel != null ||
    categoriaLabel != null
  const restricoes = view.facets.restricoes
  const tags = view.facets.tags

  return (
    <article className="flex flex-col gap-8">
      {/* Foto do prato (#130): hero PÚBLICO quando a rota anexa `imageUrl` (Receita com imagem).
          AUSENTE ⇒ estado limpo (sem moldura). <img> simples (convenção); alt = nome da Receita.
          #132: selo "✨ gerada por IA" sobreposto quando a imagem é ai_generated (honestidade). */}
      {view.imageUrl != null && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={view.imageUrl}
            alt={view.name}
            referrerPolicy="no-referrer"
            className="aspect-video w-full rounded-lg border border-border object-cover"
          />
          {view.imageAiGenerated && (
            <span className="absolute left-2 top-2 rounded-full border border-border bg-surface/90 px-2 py-0.5 text-xs font-medium text-muted">
              {m.busca.imagemSeloIa}
            </span>
          )}
        </div>
      )}
      {/* Cabeçalho estilo Instagram (#161): selo de proveniência + título (já vem PRONTO da rota)
          + selo discreto "tradução automática" quando a leitura repousa numa tradução automática
          NÃO-revisada (`autoTranslationSignal`, derivado da proveniência no read model — a UI NÃO
          re-deriva a regra). Autoria NÃO mora mais aqui: o crédito "por <name>" foi p/ o FINAL. */}
      <header className="flex flex-col gap-3">
        <ProvenanceBadge variant={section} label={badgeLabel} />
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-4xl font-semibold tracking-tight text-fg">
            {view.name}
          </h1>
          {/* Selo "tradução automática" (#161): toque LEVE (text-xs muted), guiado SÓ pela
              proveniência (`autoTranslationSignal`). Reusa o rótulo i18n já existente
              (busca.traducaoAutomatica) — mesmo conceito do kicker da Busca/Feed, não duplicar. */}
          {view.autoTranslationSignal && (
            <span className="text-xs font-medium text-muted">{m.busca.traducaoAutomatica}</span>
          )}
        </div>
      </header>

      {/* #237 (aviso de catálogo AI-assistido, SEO #187): CORTESIA editorial OPCIONAL — frase discreta
          (text-sm muted, sem cor nova) exibida SÓ quando a página a anexa (catálogo + config ligada). É
          ADITIVA: o selo de proveniência (header acima) e o selo "gerada por IA" (sobre a foto) seguem
          intactos — este bloco NUNCA os substitui. `<aside>` rotulado p/ AT (contexto, não conteúdo da
          receita); fora da árvore de headings de leitura. AUSENTE quando a página não passa o texto. */}
      {catalogDisclosure != null && (
        <aside
          aria-label={m.detalhe.catalogoAvisoRotulo}
          className="max-w-[68ch] text-sm text-muted"
        >
          {catalogDisclosure}
        </aside>
      )}

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

      {/* Descrição — logo após o título (estilo Instagram: legenda em foco). Só quando presente.
          Medida limitada (~68ch) p/ leitura confortável. */}
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

      {/* Metadados escalares (porções/dificuldade/cozinha/categoria) → <dl>. Cada par é
          omitido quando nulo (tela limpa). O <dl> inteiro some quando não há escalar.
          #161: METADADOS/restrições/tags ficam DEPOIS do conteúdo de leitura (foco na receita). */}
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
          {/* Tempo de preparo (#261, ADR-0023): total quando presente; ativo adicional quando
              presente. ativo-sozinho é impossível (CHECK do DB). formatDuracao → "1 h 30 min". */}
          {view.tempoTotalMin != null && (
            <>
              <dt className="font-medium text-muted">{m.detalhe.tempoTotal}</dt>
              <dd className="text-fg">{formatDuracao(view.tempoTotalMin)}</dd>
            </>
          )}
          {view.tempoAtivoMin != null && (
            <>
              <dt className="font-medium text-muted">{m.detalhe.tempoAtivo}</dt>
              <dd className="text-fg">{formatDuracao(view.tempoAtivoMin)}</dd>
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

      {/* Crédito ao FINAL (#161, estilo Instagram), MENOR (text-sm muted), fechando a leitura.
          #169/ADR-0019: a IMPORTADA da web credita a FONTE EXTERNA — "fonte: <site/host>" linkando a
          URL de origem (target=_blank + rel external/nofollow, como os links "da web" da Busca), NUNCA
          "por <Usuário>" (o read-model já suprime `author` quando há `source`). Caso contrário, o
          byline humano "por <name>" linkando o perfil público /u/<handle> (Receita com dono humano —
          Catálogo/sistema não tem). Os dois são mutuamente exclusivos. */}
      {view.source ? (
        <p className="text-sm text-muted">
          <a
            href={view.source.url}
            target="_blank"
            rel="noopener noreferrer nofollow external"
            aria-label={m.detalhe.fonteVerNoSite}
            className="hover:text-fg hover:underline"
          >
            {m.detalhe.fonte.replace('{fonte}', sourceDisplayName(view.source))}
          </a>
        </p>
      ) : (
        view.author && (
          <p className="text-sm text-muted">
            <Link
              href={`/u/${view.author.handle}`}
              className="hover:text-fg hover:underline"
            >
              {m.busca.porAutor.replace('{name}', view.author.name)}
            </Link>
          </p>
        )
      )}
    </article>
  )
}
