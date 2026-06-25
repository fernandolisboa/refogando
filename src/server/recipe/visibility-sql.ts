import { sql, type SQL } from 'drizzle-orm'

/**
 * Fragmento SQL CRU da visibilidade-de-comunidade (issue #52) — espelha o predicado puro
 * `isCommunityVisible` (`@/domain/recipe-visibility-check`) para os loaders SQL crus
 * (`search.ts`/`feed.ts`), que NÃO podem usar o query builder: emitem `recipe` sob aliases
 * (`r`, `r2`) dentro de CTEs, e `communityVisibleCondition` qualificaria pelo nome da tabela
 * (`"recipe"."owner_id"`), quebrando a referência ao alias.
 *
 * Ponto único de edição da regra de visibilidade-de-comunidade no SQL cru; um novo valor de
 * visibilidade (ex.: `unlisted`) é alterado SÓ aqui (+ no predicado puro e na condição
 * Drizzle). Recebe o alias da tabela `recipe` no escopo e devolve, byte-idêntico ao que estava
 * inline: `(<alias>.owner_id IS NULL OR <alias>.visibility = 'public')`.
 *
 * O alias é validado contra um conjunto restrito (identificadores simples) — defensivo, já que
 * só literais do código (`'r'`/`'r2'`) o alimentam; nunca entrada de usuário.
 */
export function communityVisibleSqlFragment(alias: string): SQL {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new Error(`communityVisibleSqlFragment: alias inválido ${JSON.stringify(alias)}`)
  }
  return sql.raw(`(${alias}.owner_id IS NULL OR ${alias}.visibility = 'public')`)
}

/**
 * Fragmento SQL CRU da leitura visível para um VIEWER (issue #116). Estende o gate de
 * visibilidade-de-comunidade com a terceira arma: as PRÓPRIAS Receitas do viewer
 * (`<alias>.owner_id = <viewerId>`), independente de visibilidade — uma Busca/Feed por um
 * usuário LOGADO inclui as suas privadas além do pool da comunidade. Sem `viewerId`
 * (Visitante anônimo, ADR-0011), reduz BYTE-A-BYTE ao `communityVisibleSqlFragment` — o
 * caminho anônimo/curador/tradução fica inalterado.
 *
 * SEGURANÇA (leak-safety, requisito #1 da #116): `viewerId` NUNCA é interpolado na string
 * crua (seria injeção). O alias (literal do código, `'r'`/`'r2'`) é interpolado via
 * `sql.raw`; o `viewerId` é BINDADO como parâmetro do template `sql\`...\`` (`${viewerId}`),
 * que o postgres-js envia separado do texto SQL. A arma extra é EXATAMENTE
 * `owner_id = <viewerId>` (igualdade ao próprio dono) — nunca afrouxa o gate para Receitas
 * de OUTROS donos.
 *
 * ORTOGONAL à moderação (`moderation_removed_at`, #18): o chamador continua combinando via
 * `AND` com os demais filtros do seu gate. (Quando o chamador inclui o gate de moderação, as
 * próprias removidas-do-pool ainda não saem da Busca/Feed — espelha o comportamento do pool
 * para linhas de comunidade; a leitura-do-dono da removida vive no detalhe, não aqui.)
 */
export function viewerReadableSqlFragment(alias: string, viewerId?: string): SQL {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new Error(`viewerReadableSqlFragment: alias inválido ${JSON.stringify(alias)}`)
  }
  // Sem viewer (anônimo): reduz ao gate de comunidade puro — byte-a-byte com o de hoje.
  if (viewerId === undefined) {
    return communityVisibleSqlFragment(alias)
  }
  // Com viewer: o prefixo (gate de comunidade + a coluna owner_id do viewer) sai de `sql.raw`
  // (só o alias literal do código entra ali); o `viewerId` é BINDADO como param do template
  // (`${viewerId}`) — postgres-js o envia separado do texto SQL (sem injeção). O fechamento
  // `)` também é raw. Resultado:
  //   (<alias>.owner_id IS NULL OR <alias>.visibility = 'public' OR <alias>.owner_id = $N)
  return sql`${sql.raw(
    `(${alias}.owner_id IS NULL OR ${alias}.visibility = 'public' OR ${alias}.owner_id = `,
  )}${viewerId}${sql.raw(')')}`
}

/**
 * Fragmento SQL CRU do POOL PÚBLICO de um CONJUNTO de donos (issue #277, Feed Seguindo) — a
 * generalização de `list-public.ts` (público de UM dono) para muitos. Três armas combinadas:
 *   (<alias>.visibility = 'public' AND <alias>.origin <> 'web_imported' AND <alias>.owner_id IN (...))
 *
 * - `visibility='public'`: SÓ o que o dono publicou — privada de 3º NUNCA aparece (allowlist; um
 *   futuro valor de visibilidade fica de fora por padrão, direção segura).
 * - `origin <> 'web_imported'`: cinto-e-suspensório do `eligibleForPool` (#168/ADR-0019). A importada
 *   da web é sempre private (o guard de visibilidade a barra de virar pública), mas o eixo EXPLÍCITO
 *   impede que um bug futuro vaze conteúdo de 3º importado neste feed social — a invariante
 *   web_imported⇒private é app-level, sem CHECK no DB.
 * - `owner_id IN (ids)`: escopa aos SEGUIDOS. NULL nunca casa `IN (...)`, então o CATÁLOGO
 *   (owner NULL) é excluído POR CONSTRUÇÃO (não por `visibility`) — sem precisar de cláusula extra.
 *
 * Os predicados CONSTANTES do pool (`result_kind <> 'playful'`, `moderation_removed_at IS NULL`)
 * vivem no template do feed (herdados de `loadFeed`), combinados via AND pelo chamador.
 *
 * SEGURANÇA: os `ids` NUNCA entram na string crua (seria injeção). O alias (literal do código) vai
 * por `sql.raw`; cada id é BINDADO `::uuid` via `sql.join` (postgres-js o envia separado do texto).
 * REQUER `ids` NÃO-VAZIO — `IN ()` é erro de sintaxe (→ 500); o chamador (`loadFollowingFeed`)
 * curto-circuita `ids.length === 0 → []` ANTES de montar qualquer SQL.
 */
export function followeesPublicSqlFragment(alias: string, ids: string[]): SQL {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new Error(`followeesPublicSqlFragment: alias inválido ${JSON.stringify(alias)}`)
  }
  if (ids.length === 0) {
    throw new Error('followeesPublicSqlFragment: ids vazio (o chamador deve curto-circuitar antes)')
  }
  const inList = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )
  return sql`${sql.raw(
    `(${alias}.visibility = 'public' AND ${alias}.origin <> 'web_imported' AND ${alias}.owner_id IN (`,
  )}${inList}${sql.raw('))')}`
}

/**
 * Fragmento SQL CRU da RECEITA PÚBLICA ELEGÍVEL (issue #278, trilho de Cozinheiros recomendados) — o
 * gate `eligibleForPool` (`@/domain/recipe-pool`) reduzido ao ramo OWNER-PUBLICADO, para o loader de
 * popularidade (`recommended-cooks.ts`) qualificar as receitas de um Cozinheiro num JOIN cru:
 *   (<alias>.visibility = 'public' AND <alias>.result_kind <> 'playful'
 *      AND <alias>.moderation_removed_at IS NULL AND <alias>.origin <> 'web_imported')
 *
 * É o MESMO conjunto de armas do `eligibleForPool` MENOS o ramo `owner_id IS NULL` (catálogo): o
 * chamador junta `recipe.owner_id = users.id`, e NULL nunca casa essa igualdade ⇒ o catálogo (sem
 * Cozinheiro a ranquear) fica de fora POR CONSTRUÇÃO, sem cláusula extra. `result_kind <> 'playful'`
 * e `origin <> 'web_imported'` são cinto-e-suspensório (ambos ⇒ private, barrados por `visibility`),
 * mas o eixo explícito blinda contra um bug futuro — ponto único da regra no SQL cru, espelhando
 * `eligibleForPool`. Sem `viewerId`/`ids`: o gate é GLOBAL (popularidade não-personalizada, Modelo B).
 *
 * SEGURANÇA: só o alias (literal do código, ex. `'r'`) entra via `sql.raw`; nenhuma entrada de usuário.
 */
export function eligiblePublicRecipeSqlFragment(alias: string): SQL {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new Error(`eligiblePublicRecipeSqlFragment: alias inválido ${JSON.stringify(alias)}`)
  }
  return sql.raw(
    `(${alias}.visibility = 'public'` +
      ` AND ${alias}.result_kind <> 'playful'` +
      ` AND ${alias}.moderation_removed_at IS NULL` +
      ` AND ${alias}.origin <> 'web_imported')`,
  )
}
