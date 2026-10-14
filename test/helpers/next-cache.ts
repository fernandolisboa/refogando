/**
 * Dublê de `next/cache` para a suíte node (sem runtime do Next). O `unstable_cache`/`revalidateTag` de
 * verdade exigem o incrementalCache do servidor do Next e lançam "Invariant: incrementalCache missing"
 * fora dele. `test/setup.ts` registra este módulo com `vi.mock('next/cache', ...)` para toda a suíte e
 * zera o armazenamento em todo `beforeEach`.
 *
 * Imita o que os testes precisam observar: a chave (`cb.toString()` + `keyParts` + argumentos, como o
 * Next), o valor passando por JSON (o Data Cache guarda JSON), a expiração por `revalidate` e a remoção
 * por tag. Diferença consciente: o Next serve o valor vencido uma vez e recalcula em segundo plano
 * (stale-while-revalidate); aqui o vencido é recalculado na hora.
 */

type Callback = (...args: unknown[]) => Promise<unknown>

type Entry = { json: string | undefined; tags: string[]; expiresAt: number }

const store = new Map<string, Entry>()
let calls: Array<{ tag: string; profile: unknown }> = []

export function unstable_cache<T extends Callback>(
  cb: T,
  keyParts?: string[],
  options: { revalidate?: number | false; tags?: string[] } = {},
): T {
  const wrapped = async (...args: unknown[]) => {
    const key = JSON.stringify([cb.toString(), keyParts ?? [], args])
    const hit = store.get(key)
    if (hit && hit.expiresAt > Date.now()) {
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
  for (const [key, entry] of store) {
    if (entry.tags.includes(tag)) store.delete(key)
  }
}

/** Zera o armazenamento e o registro de `revalidateTag` (chamado no `beforeEach` de `test/setup.ts`). */
export function resetFakeNextCache(): void {
  store.clear()
  calls = []
}

/** Chamadas de `revalidateTag` desde o último reset, para asserir a invalidação. */
export function revalidatedTags(): ReadonlyArray<{ tag: string; profile: unknown }> {
  return calls
}

/** Quantas entradas estão guardadas (para provar que houve cache). */
export function cachedEntryCount(): number {
  return store.size
}
