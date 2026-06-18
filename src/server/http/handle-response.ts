/**
 * Mapeia a resposta do `fetch` da própria API (issue #57) em um resultado discriminado.
 * PURO — SEM `next/navigation`/`next/headers`: a página traduz o resultado em
 * `notFound()` / `throw` / segue, então o branch novo da #57 (status → efeito) fica
 * testável no jsdom sem subir o runtime do App Router.
 *
 * 404 → `notFound` (leak-safe: a rota devolve o MESMO 404 p/ malformado/ausente/sem-acesso).
 * Qualquer outro não-OK → `error` (a página lança → `error.tsx` global). 2xx → `ok`.
 */
export type FetchOutcome =
  | { kind: 'ok' }
  | { kind: 'notFound' }
  | { kind: 'error'; status: number }

export function handleResponse(res: { ok: boolean; status: number }): FetchOutcome {
  if (res.status === 404) return { kind: 'notFound' }
  if (!res.ok) return { kind: 'error', status: res.status }
  return { kind: 'ok' }
}
