/**
 * Normalização do host da atribuição da fonte (#272/#169, ADR-0019) — PURO, sem rede.
 *
 * Fonte ÚNICA da regra "o `sourceName` é só o host, ou há um nome humano a remover?". O gate do
 * servidor (`clearSourceAttribution`) e o predicado de visibilidade do botão no cliente
 * (`ClearAttributionButton`) usam a MESMA função — senão as duas pontas divergem e o botão aparece
 * sobre um no-op (ou some quando deveria aparecer). `sourceNameFromUrl` (web-search) também delega aqui.
 */

/** Host "pelado": lowercase, sem `www.` e sem ponto final. `null` se a URL é inválida/sem host. */
export function bareHost(url: string | null | undefined): string | null {
  if (!url) return null
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return null
  }
  if (host === '') return null
  return host.startsWith('www.') ? host.slice(4) : host
}

/**
 * `true` se o `sourceName` é apenas o host da `sourceUrl` (ou se não há nome) — i.e., NÃO há um nome
 * humano a remover. Normaliza o nome do mesmo jeito que `bareHost` para casar o fallback de host gravado
 * na importação (ex.: `www.Exemplo.com` ~ `exemplo.com`). Com nome porém sem host derivável ⇒ `false`
 * (trata como nome real — não esconde a ação à toa).
 */
export function sourceNameIsHost(
  sourceName: string | null | undefined,
  sourceUrl: string | null | undefined,
): boolean {
  if (!sourceName) return true // sem nome = nada a remover
  const host = bareHost(sourceUrl)
  if (host == null) return false // sem host derivável: o nome NÃO é host (há nome real)
  const normalizedName = sourceName.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
  return normalizedName === host
}
