import { createHash } from 'node:crypto'
import { and, eq, isNotNull } from 'drizzle-orm'
import sharp from 'sharp'
import type { Database } from '@/db/client'
import { recipeImage, recipeReview, users } from '@/db/schema'
import { avatarPathPrefix } from '@/server/images/avatar-blob'
import { deleteOrphanBlobsConcurrently } from '@/server/images/image-blobs'
import { IMAGE_INPUT_PIXEL_LIMIT } from '@/server/images/image-derivatives'
import type { ImageStore, ListedBlob } from '@/server/images/image-store'
import { AVATAR_PHOTO_SPEC, RECIPE_PHOTO_SPEC, reencodeUserPhoto, type UserPhotoSpec } from '@/server/images/user-photo'
import type { TimeBudget } from '@/server/time-budget'

/**
 * Varredura semanal do Blob (#603, ADR-0050 "Consequências"). Dois trabalhos numa passada:
 *
 * 1. **Blob órfão.** A eliminação, a varredura diária, o "apagar receita" e as trocas de imagem apagam o blob
 *    DEPOIS de gravar o banco, num melhor esforço: um timeout ou o Blob fora do ar deixa arquivo sem linha que o
 *    referencie, numa URL pública não listada. Esta passada lista o store (`list()`) nos prefixos que o app
 *    grava (`BLOB_SWEEP_PREFIXES`) e apaga o blob que nenhuma coluna referencia (`users.image`,
 *    `recipe_image.blob_url`/`thumb_url`/`detail_url`, `recipe_review.photo_url`).
 *
 *    Apagar blob é IRREVERSÍVEL (o Blob não tem lixeira; o backup do Neon não guarda arquivos), e o caso perigoso
 *    é um banco que perdeu linhas: ali o "órfão" é a única cópia da imagem que o banco perdeu. Travas:
 *    - CARÊNCIA: só blob gravado há mais de `BLOB_SWEEP_GRACE_MS` (o upload grava o blob ANTES da linha);
 *    - prefixo desconhecido nunca é tocado (o store pode ter outra coisa);
 *    - RETIDOS: órfão gravado antes de `BLOB_SWEEP_RETAIN_BEFORE` nunca sai sozinho. São, na maioria, as imagens
 *      das linhas que o incidente de 2026-09-09 apagou (o banco voltou do backup de 06/07); o que fazer com
 *      elas é decisão do Fernando (handoff 86). Contados em `orfaosRetidos`, fora da proporção;
 *    - TRAVA de proporção (`travada=1`, a passada não apaga NADA e não mexe em foto nenhuma): os órfãos apagáveis
 *      passam de `BLOB_SWEEP_MAX_ORPHAN_RATIO` dos blobs antigos não retidos (`antigosNaoRetidos`), com pelo
 *      menos `BLOB_SWEEP_RATIO_MIN_ORPHANS`. Pega um banco que perdeu muitas linhas recentes;
 *    - PAUSA manual: `BLOB_SWEEP_PAUSE=1` (na rota). Uma restauração de backup recente perde só as linhas de
 *      poucos dias, abaixo da proporção, então quem restaura liga a pausa ANTES (roteiro em
 *      `.github/workflows/db-backup.yml`). Uma trava automática por "linha mais nova do banco" foi descartada:
 *      qualquer escrita depois da restauração (um cadastro, o cron diário) a desarma, e ela travava sozinha
 *      quando um upload falhava sem outra escrita na semana;
 *    - no máximo `BLOB_SWEEP_MAX_DELETES` deleções por passada; o resto sai na semana seguinte.
 *    Idempotente: uma segunda passada não acha o que a primeira apagou.
 *
 * 2. **Fotos antigas com metadado** (até `LEGACY_PHOTO_AUDIT_UNTIL`, e só sem trava). O re-encode no servidor
 *    (#596) só vale para envio novo; avatar e foto de receita gravados antes de `LEGACY_PHOTO_CUTOFF` podem ter
 *    EXIF/GPS, se o cliente mandou os bytes crus. Para cada um ainda referenciado, baixa e lê `metadata()`: com
 *    EXIF, XMP ou IPTC, re-encoda pelo MESMO pipeline do #596 (`reencodeUserPhoto`), grava o blob novo, troca a
 *    URL no banco (só se ainda for a mesma: `WHERE coluna = antiga`) e apaga o antigo. A foto de avaliação já
 *    era limpa desde #365 e a imagem gerada por IA não vem do aparelho de ninguém: ficam fora. Os derivados WebP
 *    não mudam (o sharp nunca copiou metadado para eles). O blob novo nasce depois do corte, então não volta à
 *    fila; a foto limpa antiga volta toda semana até a data final (custo de download pequeno e com prazo). A
 *    ordem gira por hora (hash da URL com a hora), para um orçamento curto não verificar sempre as mesmas, nem
 *    numa execução manual extra.
 *
 * Nada aqui loga URL, caminho ou id: a rota escreve UMA linha `[blob-sweep]` só com contagens.
 */

/** Prefixos que o app grava (`pathPrefix` de `ImageStore.store`): avatar, imagem de receita e derivados, avaliação. */
export const BLOB_SWEEP_PREFIXES = ['avatars/', 'recipes/', 'reviews/'] as const
/** Idade mínima de um blob para contar como órfão: o upload grava o blob antes da linha do banco. */
export const BLOB_SWEEP_GRACE_MS = 24 * 60 * 60 * 1000
/** Órfão gravado antes disto nunca sai sozinho (restauração do incidente de 2026-09-09 em 2026-09-18). */
export const BLOB_SWEEP_RETAIN_BEFORE = new Date('2026-09-19T00:00:00Z')
/** Acima desta fração de órfãos entre os blobs antigos, a passada não apaga nada (banco errado ou restaurado). */
export const BLOB_SWEEP_MAX_ORPHAN_RATIO = 0.25
/** A trava de proporção só vale a partir deste número de órfãos (um store pequeno com 2 órfãos em 5 é normal). */
export const BLOB_SWEEP_RATIO_MIN_ORPHANS = 20
/** Orçamento de tempo da passada (a rota tem `maxDuration = 300`). */
export const BLOB_SWEEP_BUDGET_MS = 240_000
/** Não começa página nem foto nova com menos que isto: o download e o re-encode de uma foto cabem aqui. */
export const BLOB_SWEEP_RESERVE_MS = 30_000
/** Teto de deleções por passada. */
export const BLOB_SWEEP_MAX_DELETES = 500
/** Página do `list()` (o máximo do Vercel Blob). */
const LIST_PAGE = 1000

/** Merge do #607 (re-encode do avatar e da foto de receita, #596) com folga para o deploy: o que é anterior pode ter EXIF. */
export const LEGACY_PHOTO_CUTOFF = new Date('2026-10-23T01:30:00Z')
/** Depois desta data o passo das fotos antigas não roda mais (seis passadas semanais, de 2026-10-24 a 11-28). */
export const LEGACY_PHOTO_AUDIT_UNTIL = new Date('2026-11-30T00:00:00Z')

export type BlobSweepCounts = {
  /** Blobs listados nos prefixos. */
  listados: number
  /** Desses, os gravados antes da carência (candidatos). */
  antigos: number
  /** Candidatos sem nenhuma referência no banco, retidos ou não. */
  orfaos: number
  /** Órfãos gravados antes de `BLOB_SWEEP_RETAIN_BEFORE`: nunca saem sozinhos. */
  orfaosRetidos: number
  /** Blobs antigos gravados depois de `BLOB_SWEEP_RETAIN_BEFORE`: o denominador da trava de proporção. */
  antigosNaoRetidos: number
  /** Órfãos apagados de fato. */
  apagados: number
  /** 1 quando uma trava segurou a passada (nada apagado, nenhuma foto mexida). */
  travada: number
  /** 1 quando o orçamento acabou antes de listar tudo (a próxima passada recomeça do zero). */
  listagemIncompleta: number
  /** Fotos antigas (avatar e foto de receita anteriores ao corte) baixadas e lidas. */
  fotosVerificadas: number
  /** Delas, as que tinham EXIF, XMP ou IPTC. */
  fotosComMetadado: number
  /** Re-encodadas e trocadas no banco. */
  fotosReencodadas: number
  /** Download, leitura, re-encode ou gravação que falhou (a foto fica como está e volta na próxima passada). */
  fotosFalhas: number
  /** Fotos antigas que ficaram para a próxima passada (orçamento). */
  fotosRestantes: number
}

/** Como o banco referencia uma URL. O avatar leva a conta: o re-encode grava sob o prefixo dela (#604). */
type Ref = { kind: 'avatar'; userId: string } | { kind: 'recipePhoto' } | { kind: 'other' }
const OTHER: Ref = { kind: 'other' }

/**
 * Todas as URLs que o banco referencia, e como: avatar (`users.image`), foto de receita enviada por pessoa (o
 * original de uma `recipe_image` `user_photo`) ou outra referência (derivado, imagem de IA, foto de avaliação).
 * Lê cada tabela UMA vez (nenhuma dessas colunas tem índice, e conferir por URL varreria a tabela a cada
 * lote); são alguns MB por mil imagens, folgado na função.
 */
async function loadReferences(db: Database): Promise<Map<string, Ref>> {
  const kinds = new Map<string, Ref>()
  const mark = (url: string | null, ref: Ref) => {
    if (!url) return
    // Uma URL referenciada mais de uma vez vira "outra" e fica fora da auditoria: antes do #604 uma conta podia
    // plantar em `users.image` a URL da foto de receita (ou do avatar) de outra pessoa, e re-encodar pela linha
    // errada apagaria o blob que a outra linha ainda usa.
    kinds.set(url, kinds.has(url) ? OTHER : ref)
  }
  const [images, reviews, avatars] = await Promise.all([
    db
      .select({
        blobUrl: recipeImage.blobUrl,
        thumbUrl: recipeImage.thumbUrl,
        detailUrl: recipeImage.detailUrl,
        provenance: recipeImage.provenance,
      })
      .from(recipeImage),
    db.select({ u: recipeReview.photoUrl }).from(recipeReview).where(isNotNull(recipeReview.photoUrl)),
    db.select({ id: users.id, u: users.image }).from(users).where(isNotNull(users.image)),
  ])
  for (const r of images) {
    mark(r.thumbUrl, OTHER)
    mark(r.detailUrl, OTHER)
  }
  for (const r of reviews) mark(r.u, OTHER)
  for (const r of images) mark(r.blobUrl, r.provenance === 'user_photo' ? { kind: 'recipePhoto' } : OTHER)
  for (const r of avatars) mark(r.u, { kind: 'avatar', userId: r.id })
  // Pelo mesmo motivo, só entra na auditoria o arquivo que mora no prefixo do próprio tipo.
  for (const [url, ref] of kinds) {
    if (ref.kind !== 'other' && !blobPath(url).startsWith(ref.kind === 'avatar' ? '/avatars/' : '/recipes/')) {
      kinds.set(url, OTHER)
    }
  }
  return kinds
}

function blobPath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return ''
  }
}

/** Ordem que gira a cada hora: hash da URL com a hora (horas desde a época). */
function rotatingOrder(blobs: ListedBlob[], now: Date): ListedBlob[] {
  const hour = Math.floor(now.getTime() / (60 * 60 * 1000))
  const key = (b: ListedBlob) => createHash('sha1').update(`${hour}:${b.url}`).digest('hex')
  return blobs
    .map((b) => ({ b, k: key(b) }))
    .sort((x, y) => (x.k < y.k ? -1 : x.k > y.k ? 1 : 0))
    .map((x) => x.b)
}

/** Os metadados que o re-encode descarta (GPS mora no EXIF ou no XMP). */
function hasPersonalMetadata(meta: sharp.Metadata): boolean {
  return Boolean(meta.exif?.length || meta.xmp?.length || meta.iptc?.length)
}

type LegacyPhotoOutcome = {
  /** A foto tinha EXIF, XMP ou IPTC (falso também quando nem deu para ler). */
  metadado: boolean
  /** `trocada`: a pessoa trocou a foto no meio; o blob novo saiu e nada mudou no banco. */
  desfecho: 'limpa' | 'reencodada' | 'trocada' | 'falha'
}

/**
 * Uma foto antiga: baixa, lê o metadado e, se houver, re-encoda e troca a URL no banco. Nunca lança; devolve o
 * desfecho para as contagens.
 */
async function auditLegacyPhoto(
  db: Database,
  store: ImageStore,
  blob: ListedBlob,
  ref: Exclude<Ref, { kind: 'other' }>,
): Promise<LegacyPhotoOutcome> {
  let metadado = false
  try {
    const got = await store.get(blob.url)
    if (!got) return { metadado, desfecho: 'falha' }
    metadado = hasPersonalMetadata(await sharp(got.data, { limitInputPixels: IMAGE_INPUT_PIXEL_LIMIT }).metadata())
    if (!metadado) return { metadado, desfecho: 'limpa' }
    const spec: UserPhotoSpec = ref.kind === 'avatar' ? AVATAR_PHOTO_SPEC : RECIPE_PHOTO_SPEC
    const clean = await reencodeUserPhoto(got.data, spec)
    if (!clean) return { metadado, desfecho: 'falha' }
    // O avatar novo mora sob o prefixo da conta que `loadReferences` leu (#604).
    const { url: newUrl } = await store.store({
      data: clean.data,
      contentType: clean.contentType,
      pathPrefix: ref.kind === 'avatar' ? avatarPathPrefix(ref.userId) : 'recipes',
    })
    // Troca só se o banco ainda aponta para a antiga (a pessoa pode ter trocado a foto no meio).
    const swapped =
      ref.kind === 'avatar'
        ? await db
            .update(users)
            .set({ image: newUrl, updatedAt: new Date() })
            .where(and(eq(users.id, ref.userId), eq(users.image, blob.url)))
            .returning({ id: users.id })
        : await db
            .update(recipeImage)
            .set({ blobUrl: newUrl })
            .where(and(eq(recipeImage.blobUrl, blob.url), eq(recipeImage.provenance, 'user_photo')))
            .returning({ id: recipeImage.id })
    await deleteOrphanBlobsConcurrently(store, [swapped.length > 0 ? blob.url : newUrl])
    return { metadado, desfecho: swapped.length > 0 ? 'reencodada' : 'trocada' }
  } catch {
    return { metadado, desfecho: 'falha' }
  }
}

const retained = (b: ListedBlob) => b.uploadedAt < BLOB_SWEEP_RETAIN_BEFORE

/**
 * Passos 1 e 2 da passada: lista os prefixos página a página (parando se o orçamento acabar; o que já foi listado
 * ainda conta) e lê quem o banco referencia DEPOIS da listagem, para que uma linha gravada no meio também conte.
 * `old` são os blobs fora da carência; `orphans`, os que nenhuma linha referencia.
 */
async function findOrphans(
  db: Database,
  store: ImageStore,
  opts: { now: Date; budget: TimeBudget },
): Promise<{
  old: ListedBlob[]
  kinds: Map<string, Ref>
  orphans: ListedBlob[]
  listados: number
  listagemIncompleta: number
}> {
  const graceCutoff = opts.now.getTime() - BLOB_SWEEP_GRACE_MS
  const old: ListedBlob[] = []
  let listados = 0
  let listagemIncompleta = 0
  listing: for (const prefix of BLOB_SWEEP_PREFIXES) {
    let cursor: string | undefined
    do {
      if (!opts.budget.canStartMore()) {
        listagemIncompleta = 1
        break listing
      }
      const page = await store.list({ prefix, cursor, limit: LIST_PAGE })
      listados += page.blobs.length
      for (const b of page.blobs) if (b.uploadedAt.getTime() < graceCutoff && store.owns(b.url)) old.push(b)
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)
  }
  const kinds = await loadReferences(db)
  return { old, kinds, orphans: old.filter((b) => !kinds.has(b.url)), listados, listagemIncompleta }
}

/**
 * Só leitura (#635): os órfãos RETIDOS (anteriores a `BLOB_SWEEP_RETAIN_BEFORE`), com caminho, URL e data, para
 * quem opera decidir o que fazer com eles. Não apaga nem re-encoda nada. `GET /api/admin/blob-retidos` devolve
 * isto na resposta, e NÃO no log, que continua só com contagens.
 */
export async function listRetainedOrphans(
  db: Database,
  store: ImageStore,
  opts: { now: Date; budget: TimeBudget },
): Promise<{ listagemIncompleta: number; retidos: Array<{ pathname: string; url: string; uploadedAt: string }> }> {
  const { orphans, listagemIncompleta } = await findOrphans(db, store, opts)
  return {
    listagemIncompleta,
    retidos: orphans
      .filter(retained)
      .map((b) => ({ pathname: b.pathname, url: b.url, uploadedAt: b.uploadedAt.toISOString() })),
  }
}

/** A passada inteira (doc do módulo). Erro de `list()` ou do banco LANÇA: a rota responde 500 sem ter apagado nada. */
export async function sweepBlobs(
  db: Database,
  store: ImageStore,
  opts: { now: Date; budget: TimeBudget },
): Promise<BlobSweepCounts> {
  const counts: BlobSweepCounts = {
    listados: 0,
    antigos: 0,
    orfaos: 0,
    orfaosRetidos: 0,
    antigosNaoRetidos: 0,
    apagados: 0,
    travada: 0,
    listagemIncompleta: 0,
    fotosVerificadas: 0,
    fotosComMetadado: 0,
    fotosReencodadas: 0,
    fotosFalhas: 0,
    fotosRestantes: 0,
  }
  // 1 e 2. Lista e cruza com o banco.
  const { old, kinds, orphans, listados, listagemIncompleta } = await findOrphans(db, store, opts)
  counts.listados = listados
  counts.listagemIncompleta = listagemIncompleta
  counts.antigos = old.length
  const deletable = orphans.filter((b) => !retained(b))
  counts.orfaos = orphans.length
  counts.orfaosRetidos = orphans.length - deletable.length

  // 3. Trava e deleção.
  counts.antigosNaoRetidos = old.filter((b) => !retained(b)).length
  if (
    deletable.length >= BLOB_SWEEP_RATIO_MIN_ORPHANS &&
    deletable.length > counts.antigosNaoRetidos * BLOB_SWEEP_MAX_ORPHAN_RATIO
  ) {
    counts.travada = 1
    return counts
  }
  if (deletable.length > 0) {
    counts.apagados = await deleteOrphanBlobsConcurrently(
      store,
      deletable.slice(0, BLOB_SWEEP_MAX_DELETES).map((b) => b.url),
    )
  }

  // 4. Fotos antigas com metadado (só até a data final; só blob ainda referenciado como avatar/foto de receita).
  if (opts.now < LEGACY_PHOTO_AUDIT_UNTIL) {
    const legacy = rotatingOrder(
      old.filter((b) => {
        const kind = kinds.get(b.url)?.kind
        return b.uploadedAt < LEGACY_PHOTO_CUTOFF && (kind === 'avatar' || kind === 'recipePhoto')
      }),
      opts.now,
    )
    for (const [i, blob] of legacy.entries()) {
      if (!opts.budget.canStartMore()) {
        counts.fotosRestantes = legacy.length - i
        break
      }
      const outcome = await auditLegacyPhoto(db, store, blob, kinds.get(blob.url) as Exclude<Ref, { kind: 'other' }>)
      counts.fotosVerificadas += 1
      if (outcome.metadado) counts.fotosComMetadado += 1
      if (outcome.desfecho === 'reencodada') counts.fotosReencodadas += 1
      if (outcome.desfecho === 'falha') counts.fotosFalhas += 1
    }
  }
  return counts
}
