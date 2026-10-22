import { eq } from 'drizzle-orm'
import { requireSession } from '@/server/auth/guard'
import { getDb, getImageStore } from '@/server/deps'
import { users } from '@/db/schema'
import { AVATAR_PHOTO_SPEC, reencodeUserPhoto } from '@/server/images/user-photo'

/**
 * Contrato `/api/me/avatar` — avatar do logado (#126, frente Perfil + fundação do `ImageStore`).
 *
 * Owner-only via `requireSession` (ADR-0011, mesma tese de `/api/me`): 401 = Visitante (sem sessão)
 * OU conta soft-deletada. Toca SÓ `users.image` (URL) — o avatar NÃO usa a entidade `recipe_image`
 * (ADR-0016: avatar é 1:1 com a pessoa, sem compartilhamento/carry-forward; reusa só o PRIMITIVO de
 * storage, o seam `ImageStore`).
 *
 * POST (multipart `file`): valida tipo (jpg/png/webp) e tamanho (rede do servidor; o cliente já
 * redimensiona), RE-ENCODA no servidor (#596, `reencodeUserPhoto` com `AVATAR_PHOTO_SPEC`: formato pelos
 * bytes, teto de pixels, WebP ≤1024 px SEM EXIF/GPS — o avatar é servido público; recusa ⇒ 400
 * `tipo_invalido`), guarda o WebP no `ImageStore`, grava a URL em `users.image` e — best-effort —
 * apaga o blob ANTERIOR se foi NÓS que guardamos (`store.owns`). Avatar vindo do OAuth (Google)
 * é URL ESTRANGEIRA e fica intacto. Devolve `{ image: <url> }`. Storage indisponível → 503
 * `storage_indisponivel` (degradação do seam tratada, não um 500 cru); o banco fica intacto.
 *
 * DELETE: zera `users.image` e apaga o blob anterior se foi nosso. Devolve `{ image: null }`.
 */

export const runtime = 'nodejs' // postgres-js + Buffer + sharp exigem Node, não Edge.
// O re-encode (#596) tem teto de 10 s de CPU por passada do sharp; 60 s cobre o pior caso com folga.
export const maxDuration = 60

/** Cap de tamanho do upload (2 MB). O cliente redimensiona p/ bem abaixo disso; isto é a rede. */
const MAX_BYTES = 2 * 1024 * 1024
/** Allowlist de content-type da imagem (o cliente exporta webp; aceitamos os formatos comuns). */
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export async function POST(req: Request): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: 'arquivo_ausente' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) {
    return Response.json({ error: 'arquivo_ausente' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return Response.json({ error: 'tipo_invalido' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: 'arquivo_grande' }, { status: 400 })
  }

  // #596: re-encode ANTES de tocar o banco/storage (depois do gate de sessão, tipo e tamanho): o blob público
  // nunca leva o EXIF/GPS do celular. Bytes que não são JPEG/PNG/WebP estático de verdade ⇒ 400.
  const clean = await reencodeUserPhoto(Buffer.from(await file.arrayBuffer()), AVATAR_PHOTO_SPEC)
  if (!clean) {
    return Response.json({ error: 'tipo_invalido' }, { status: 400 })
  }

  const store = getImageStore()
  const db = getDb()
  const userId = g.session.user.id

  // Lê o avatar anterior ANTES de sobrescrever (pra apagar o blob antigo se foi nosso).
  const [before] = await db.select({ image: users.image }).from(users).where(eq(users.id, userId))
  const old = before?.image ?? null

  // Guarda o novo blob ANTES do UPDATE: se o store falhar, NADA foi alterado no banco. Trata a
  // degradação do seam (token ausente em runtime, Vercel Blob fora) com um erro ESTRUTURADO 503,
  // espelhando a convenção do repo (`{ error }`) em vez de deixar virar um 500 genérico sem corpo.
  let url: string
  try {
    ;({ url } = await store.store({ data: clean.data, contentType: clean.contentType, pathPrefix: 'avatars' }))
  } catch {
    return Response.json({ error: 'storage_indisponivel' }, { status: 503 })
  }

  await db.update(users).set({ image: url, updatedAt: new Date() }).where(eq(users.id, userId))

  // Best-effort: apaga o blob anterior SÓ se foi nós que guardamos (OAuth fica intacto). Uma falha
  // aqui deixa um órfão tolerável — não falha o upload já persistido do usuário.
  await deleteOldBlob(store, old, url)

  return Response.json({ image: url })
}

export async function DELETE(req: Request): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response

  const store = getImageStore()
  const db = getDb()
  const userId = g.session.user.id

  const [before] = await db.select({ image: users.image }).from(users).where(eq(users.id, userId))
  const old = before?.image ?? null

  await db.update(users).set({ image: null, updatedAt: new Date() }).where(eq(users.id, userId))

  await deleteOldBlob(store, old, null)

  return Response.json({ image: null })
}

/** Apaga `old` se existir, for diferente do novo, e for um blob NOSSO. Best-effort (engole erros). */
async function deleteOldBlob(store: ReturnType<typeof getImageStore>, old: string | null, next: string | null): Promise<void> {
  if (!old || old === next || !store.owns(old)) return
  try {
    await store.delete(old)
  } catch {
    // Órfão tolerável: o avatar já foi trocado/removido; não propagamos a falha de limpeza.
  }
}
