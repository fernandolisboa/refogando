/**
 * Seam ÚNICO e mockável para o STORAGE de imagem (issue #126, ADR-0016 adendo do ADR-0010).
 *
 * É o **primitivo de armazenamento** que o avatar do Usuário (#126, grava em `users.image`)
 * e — depois — a Imagem da receita (entidade `recipe_image`, #130) reusam. Espelha a forma dos
 * outros seams (`embedder.ts`/`translator.ts`/`claude/client.ts`): interface + impl Real +
 * dublê Fake + dublê Throwing, resolvidos por DI em `@/server/deps`.
 *
 * Backend real: **Vercel Blob** (store PUBLIC — a URL serve a imagem direto a anônimos no perfil
 * público/pool). A impl real usa o SDK `@vercel/blob` (`put`/`del`); o token vem de
 * `BLOB_READ_WRITE_TOKEN`, lido PREGUIÇOSAMENTE no uso (não no import) — espelha o `getDb` lazy,
 * pra o build/typecheck/jsdom nunca exigirem o token e os testes NUNCA tocarem a rede (injetam
 * `FakeImageStore`).
 *
 * `owns(url)`: só apagamos o que NÓS guardamos. O avatar pode vir do OAuth (Google preenche
 * `users.image` com a foto do perfil) — essa URL é ESTRANGEIRA e jamais deve ser deletada. A
 * regra é de HOST: um blob nosso mora em `*.blob.vercel-storage.com`.
 */
import { put, del } from '@vercel/blob'

/** Bytes + metadados para guardar uma imagem. `pathPrefix` agrupa logicamente (ex.: 'avatars'). */
export type StoreImageInput = {
  data: Buffer | Uint8Array | ArrayBuffer
  contentType: string
  /** Agrupador lógico do caminho do blob (ex.: 'avatars', 'recipes'). */
  pathPrefix: string
}

/** Resultado do store: a URL pública, servível direto (a imagem é PUBLIC). */
export type StoredImage = { url: string }

export interface ImageStore {
  /** Guarda os bytes e devolve a URL pública. */
  store(input: StoreImageInput): Promise<StoredImage>
  /**
   * #285 (image-to-image): lê de volta os bytes de um blob (a imagem-base de uma edição vira
   * `inlineData` pro Gemini). Retorna `null` quando não-encontrado / resposta `!ok`; deixa um erro de
   * rede genuíno BORBULHAR (o call-site faz try/catch → 503, como no `store`). Seam, não `fetch` direto:
   * o dublê lê do próprio map (testes não tocam a rede).
   */
  get(url: string): Promise<{ data: Buffer; contentType: string } | null>
  /** Apaga um blob que NÓS guardamos. No-op SILENCIOSO se a URL não pertence a este store. */
  delete(url: string): Promise<void>
  /** A URL aponta para um blob deste store? (só apagamos o que guardamos — OAuth fica intacto.) */
  owns(url: string): boolean
}

/**
 * Sufixo de host dos blobs PÚBLICOS do Vercel Blob — fonte da regra de `owns` da impl real.
 * Casa com `**.public.blob.vercel-storage.com` do `next.config` (nosso store é PUBLIC). Exigir o
 * segmento `.public.` estreita a superfície (não casa hosts privados nem outros subdomínios) e
 * `endsWith` barra forja (`x.public.blob.vercel-storage.com.evil.com` NÃO casa). É um teste de host
 * compartilhado entre stores do Vercel — a barreira real contra apagar blob alheio é o TOKEN
 * (escopado ao nosso store: `del` num store de terceiro falha/no-op). #130+ devem revisitar caso
 * passem a gravar URLs de blob de origens não-controladas.
 */
const VERCEL_BLOB_HOST_SUFFIX = '.public.blob.vercel-storage.com'

/** Extensão de arquivo por content-type (allowlist de imagem). Vazio se desconhecido. */
function extForContentType(contentType: string): string {
  switch (contentType) {
    case 'image/jpeg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/webp':
      return '.webp'
    default:
      return ''
  }
}

/** Normaliza os bytes de entrada para algo que `put`/o map do Fake aceitem. */
function toBytes(data: Buffer | Uint8Array | ArrayBuffer): Uint8Array {
  if (data instanceof Uint8Array) return data
  return new Uint8Array(data)
}

/** Host de uma URL, ou null se a string não for uma URL válida (defensivo p/ `owns`). */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

/**
 * Impl REAL — Vercel Blob via SDK. `store` faz `put` PUBLIC com um nome de arquivo aleatório
 * (uuid) sob o `pathPrefix`, `addRandomSuffix:false` (já garantimos unicidade) e
 * `allowOverwrite:false` (um uuid não colide; colisão = erro de verdade, não sobrescrita cega).
 * O token é exigido no USO (lazy): sem ele, lança ANTES de qualquer chamada de rede.
 */
export class RealImageStore implements ImageStore {
  private requireToken(): string {
    const token = process.env.BLOB_READ_WRITE_TOKEN
    if (!token) {
      throw new Error('BLOB_READ_WRITE_TOKEN não definido (storage de imagem não configurado).')
    }
    return token
  }

  async store(input: StoreImageInput): Promise<StoredImage> {
    const token = this.requireToken()
    const pathname = `${input.pathPrefix}/${crypto.randomUUID()}${extForContentType(input.contentType)}`
    // `put` aceita Buffer (não Uint8Array cru): converte sem cópia desnecessária via `Buffer.from`.
    const res = await put(pathname, Buffer.from(toBytes(input.data)), {
      access: 'public',
      token,
      contentType: input.contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
    })
    return { url: res.url }
  }

  async get(url: string): Promise<{ data: Buffer; contentType: string } | null> {
    // Blob PUBLIC: a URL serve direto (leitura não exige token). `!res.ok` ⇒ null (não lê o body);
    // um erro de rede genuíno borbulha pro call-site (→ 503).
    const res = await fetch(url)
    if (!res.ok) return null
    const data = Buffer.from(await res.arrayBuffer())
    // content-type ausente/vazio ⇒ default 'image/png' (espelha o fallback do generator).
    const contentType = res.headers.get('content-type')?.trim() || 'image/png'
    return { data, contentType }
  }

  async delete(url: string): Promise<void> {
    if (!this.owns(url)) return
    await del(url, { token: this.requireToken() })
  }

  owns(url: string): boolean {
    const host = hostOf(url)
    return host !== null && host.endsWith(VERCEL_BLOB_HOST_SUFFIX)
  }
}

/**
 * Dublê em memória para testes — NUNCA toca a rede. Guarda os blobs num Map por URL e devolve
 * URLs determinísticas (contador `seq`, sem `Math.random`) num host próprio que `owns` reconhece.
 * `blobs` é exposto para as asserções (o blob foi guardado? o anterior foi apagado?).
 */
export class FakeImageStore implements ImageStore {
  /** Host fake que `owns` reconhece como "nosso" (≠ host estrangeiro como o do Google OAuth). */
  private static readonly HOST = 'fake-blob.local'
  readonly blobs = new Map<string, { contentType: string; bytes: Uint8Array }>()
  private seq = 0

  async store(input: StoreImageInput): Promise<StoredImage> {
    const url = `https://${FakeImageStore.HOST}/${input.pathPrefix}/${this.seq++}${extForContentType(input.contentType)}`
    this.blobs.set(url, { contentType: input.contentType, bytes: toBytes(input.data) })
    return { url }
  }

  async get(url: string): Promise<{ data: Buffer; contentType: string } | null> {
    const blob = this.blobs.get(url)
    if (!blob) return null
    return { data: Buffer.from(blob.bytes), contentType: blob.contentType }
  }

  async delete(url: string): Promise<void> {
    if (!this.owns(url)) return
    this.blobs.delete(url)
  }

  owns(url: string): boolean {
    return hostOf(url) === FakeImageStore.HOST
  }
}

/** Dublê que SEMPRE falha em store/delete — exercita a degradação (rota deve responder 5xx/erro). */
export class ThrowingImageStore implements ImageStore {
  async store(): Promise<StoredImage> {
    throw new Error('storage de imagem indisponível (dublê de degradação)')
  }

  async get(): Promise<{ data: Buffer; contentType: string } | null> {
    throw new Error('storage de imagem indisponível (dublê de degradação)')
  }

  async delete(): Promise<void> {
    throw new Error('storage de imagem indisponível (dublê de degradação)')
  }

  owns(): boolean {
    return false
  }
}
