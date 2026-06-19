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
