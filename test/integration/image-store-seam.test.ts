import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getImageStore, setImageStore, resetDeps } from '@/server/deps'
import {
  RealImageStore,
  FakeImageStore,
  ThrowingImageStore,
  type ImageStore,
  type StoreImageInput,
} from '@/server/images/image-store'

/**
 * Seam de storage de imagem (issue #126) — DI + reset + comportamento dos dublês. Espelha a forma
 * do seam de tradução/embedding: Real (impl Vercel Blob, exige token no uso), Fake (em memória,
 * nunca toca rede), Throwing (degradação). `resetDeps()` (no beforeEach global de setup.ts) DEVE
 * zerar o override — senão um store injetado vazaria entre testes.
 *
 * NENHUM teste aqui toca a rede: a impl Real é exercitada por `owns` (puro), pela GUARDA de token
 * ausente (lança ANTES de qualquer `put`/`del`) e pelo `get` com o `fetch` global trocado por um dublê
 * (limites de tempo, redirect e tamanho). O resto é o Fake.
 */

const sampleInput: StoreImageInput = {
  data: new Uint8Array([1, 2, 3, 4]),
  contentType: 'image/png',
  pathPrefix: 'avatars',
}

const BLOB_URL = 'https://abc123.public.blob.vercel-storage.com/avatars/x.png'
const FOREIGN_URL = 'https://lh3.googleusercontent.com/a/foto-do-google'

describe('seam ImageStore #126 — DI + resetDeps', () => {
  it('getImageStore devolve o override após setImageStore', () => {
    const fake = new FakeImageStore()
    setImageStore(fake)
    expect(getImageStore()).toBe(fake)
  })

  it('resetDeps zera o override → getImageStore volta a RealImageStore', () => {
    setImageStore(new FakeImageStore())
    resetDeps()
    expect(getImageStore()).toBeInstanceOf(RealImageStore)
  })
})

describe('RealImageStore — owns (puro) + guarda de token', () => {
  // A impl Real lê o token no USO; garantimos que está ausente pra a guarda disparar (e nunca
  // tocarmos a rede). Restauramos no fim pra não vazar entre suítes.
  let saved: string | undefined
  beforeEach(() => {
    saved = process.env.BLOB_READ_WRITE_TOKEN
    delete process.env.BLOB_READ_WRITE_TOKEN
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.BLOB_READ_WRITE_TOKEN
    else process.env.BLOB_READ_WRITE_TOKEN = saved
  })

  it('owns: true para host *.blob.vercel-storage.com, false para estrangeiro e lixo', () => {
    const real: ImageStore = new RealImageStore()
    expect(real.owns(BLOB_URL)).toBe(true)
    expect(real.owns(FOREIGN_URL)).toBe(false)
    expect(real.owns('não é url')).toBe(false)
  })

  it('store LANÇA sem BLOB_READ_WRITE_TOKEN (antes de qualquer chamada de rede)', async () => {
    const real: ImageStore = new RealImageStore()
    await expect(real.store(sampleInput)).rejects.toThrow(/BLOB_READ_WRITE_TOKEN/)
  })

  it('delete de URL estrangeira é no-op mesmo sem token (owns=false ⇒ nem tenta)', async () => {
    const real: ImageStore = new RealImageStore()
    await expect(real.delete(FOREIGN_URL)).resolves.toBeUndefined()
  })
})

describe('RealImageStore.get — limites do download (fetch dublê, sem rede)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Body em stream com `n` pedaços de `size` bytes (sem `content-length`, como um chunked). */
  function chunked(n: number, size: number): ReadableStream<Uint8Array> {
    let sent = 0
    return new ReadableStream({
      pull(controller) {
        if (sent++ >= n) return controller.close()
        controller.enqueue(new Uint8Array(size))
      },
    })
  }

  it('passa timeout e `redirect: error` ao fetch e devolve os bytes', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }))
    vi.stubGlobal('fetch', fetchMock)
    const got = await new RealImageStore().get(BLOB_URL)
    expect(got?.contentType).toBe('image/png')
    expect([...got!.data]).toEqual([1, 2, 3])
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('!ok ⇒ null, como antes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nada', { status: 404 })))
    expect(await new RealImageStore().get(BLOB_URL)).toBeNull()
  })

  it('content-length acima de 25 MB ⇒ lança sem ler o body', async () => {
    const res = new Response(chunked(1, 10), { headers: { 'content-length': String(26 * 1024 * 1024) } })
    vi.stubGlobal('fetch', vi.fn(async () => res))
    await expect(new RealImageStore().get(BLOB_URL)).rejects.toMatchObject({ name: 'ImageTooLarge' })
  })

  it('sem content-length, o stream passa de 25 MB ⇒ lança ao estourar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(chunked(30, 1024 * 1024))))
    await expect(new RealImageStore().get(BLOB_URL)).rejects.toMatchObject({ name: 'ImageTooLarge' })
  })
})

describe('FakeImageStore — em memória, sem rede', () => {
  it('store guarda o blob e devolve uma URL que owns reconhece', async () => {
    const fake = new FakeImageStore()
    const { url } = await fake.store(sampleInput)
    expect(fake.owns(url)).toBe(true)
    expect(fake.blobs.has(url)).toBe(true)
    expect(fake.blobs.get(url)?.contentType).toBe('image/png')
  })

  it('store gera URLs distintas por chamada (sem colisão)', async () => {
    const fake = new FakeImageStore()
    const a = await fake.store(sampleInput)
    const b = await fake.store(sampleInput)
    expect(a.url).not.toBe(b.url)
  })

  it('delete remove só o blob nosso; URL estrangeira é no-op (não apaga nada)', async () => {
    const fake = new FakeImageStore()
    const { url } = await fake.store(sampleInput)
    await fake.delete(FOREIGN_URL) // estrangeira → no-op
    expect(fake.blobs.has(url)).toBe(true)
    await fake.delete(url) // nossa → some
    expect(fake.blobs.has(url)).toBe(false)
  })

  it('owns: false para host estrangeiro', () => {
    expect(new FakeImageStore().owns(FOREIGN_URL)).toBe(false)
  })
})

describe('ThrowingImageStore — dublê de degradação', () => {
  it('store e delete LANÇAM; owns é false', async () => {
    const t: ImageStore = new ThrowingImageStore()
    await expect(t.store(sampleInput)).rejects.toThrow(/indisponível/)
    await expect(t.delete(BLOB_URL)).rejects.toThrow(/indisponível/)
    expect(t.owns(BLOB_URL)).toBe(false)
  })
})
