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
