/**
 * Dublê de `next/cache` para a suíte node (sem runtime do Next). O `unstable_cache`/`revalidateTag` de
 * verdade exigem o incrementalCache do servidor do Next e lançam "Invariant: incrementalCache missing"
 * fora dele. `test/setup.ts` registra este módulo com `vi.mock('next/cache', ...)` para toda a suíte e
 * zera o armazenamento em todo `beforeEach`.
 *
 * Imita o que os testes precisam observar: a chave (`cb.toString()` + `keyParts` + argumentos, como o
 * Next), o valor passando por JSON (o Data Cache guarda JSON), a expiração por `revalidate` e a
 * invalidação por tag conforme o perfil: `{ expire: 0 }` (ou sem perfil) remove a entrada; `'max'` só a
 * deixa vencida (o Next a serviria uma vez e recalcularia em segundo plano). Diferença consciente: o
 * Next serve o valor vencido e recalcula em segundo plano (stale-while-revalidate); aqui, por padrão, o
 * vencido é recalculado na hora. `serveStaleEntries()` liga o comportamento do Next de devolver a
 * entrada vencida, mas o refresh em segundo plano NÃO é modelado: a entrada fica vencida até o reset,
 * uma invalidação `{ expire: 0 }` ou o desligamento do modo.
 *
 * Só existem aqui os exports que o app usa hoje (`unstable_cache`, `revalidateTag`): uma API nova de
 * `next/cache` (revalidatePath, updateTag, refresh…) precisa de um stub aqui, senão chega `undefined`.
 */

type Callback = (...args: unknown[]) => Promise<unknown>

type Entry = { json: string | undefined; tags: string[]; expiresAt: number }

const store = new Map<string, Entry>()
let calls: Array<{ tag: string; profile: unknown }> = []
let serveStale = false
let failRevalidate = false

export function unstable_cache<T extends Callback>(
  cb: T,
  keyParts?: string[],
  options: { revalidate?: number | false; tags?: string[] } = {},
): T {
  const wrapped = async (...args: unknown[]) => {
    const key = JSON.stringify([cb.toString(), keyParts ?? [], args])
    const hit = store.get(key)
    if (hit && (serveStale || hit.expiresAt > Date.now())) {
      return hit.json === undefined ? undefined : JSON.parse(hit.json)
    }
    const value = await cb(...args)
    const ttl = typeof options.revalidate === 'number' ? options.revalidate * 1000 : Infinity
    store.set(key, { json: JSON.stringify(value), tags: options.tags ?? [], expiresAt: Date.now() + ttl })
    return value
  }
  return wrapped as T
}

export function revalidateTag(tag: string, profile: unknown): void {
  calls.push({ tag, profile })
  if (failRevalidate) throw new Error(`revalidateTag falhou (dublê): ${tag}`)
  for (const [key, entry] of store) {
    if (!entry.tags.includes(tag)) continue
    if (profile === 'max') entry.expiresAt = 0
    else store.delete(key)
  }
}

/** Zera o armazenamento e o registro de `revalidateTag` (chamado no `beforeEach` de `test/setup.ts`). */
export function resetFakeNextCache(): void {
  store.clear()
  calls = []
  serveStale = false
  failRevalidate = false
}

/** Devolve as entradas vencidas em vez de recalcular, como o Next no primeiro request depois do prazo. */
export function serveStaleEntries(on = true): void {
  serveStale = on
}

/**
 * Faz `revalidateTag` lançar (a chamada ainda fica registrada e nada é removido), para provar que uma
 * falha ao expirar a tag não transforma a escrita gravada num erro.
 */
export function failRevalidateTag(on = true): void {
  failRevalidate = on
}

/** Chamadas de `revalidateTag` desde o último reset, para asserir a invalidação. */
export function revalidatedTags(): ReadonlyArray<{ tag: string; profile: unknown }> {
  return calls
}

/** Quantas entradas estão guardadas (para provar que houve cache). */
export function cachedEntryCount(): number {
  return store.size
}
