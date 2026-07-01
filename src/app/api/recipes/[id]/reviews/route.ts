import sharp from 'sharp'
import { requireSession } from '@/server/auth/guard'
import { getDb, getImageStore } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { applyReview, loadRecipeReviews, type ReviewPhoto } from '@/server/recipe/review'

/**
 * Avaliação de uma Receita do pool (issue #363, ADR-0027). Routes FINOS espelhando vote/report.
 *
 * POST/PUT (ambos = upsert/salvar; PUT é alias semântico): valida uuid → 404; exige SESSÃO → 401
 * ANTES do DB (anônimo = zero efeito); parse defensivo do body (malformado ⇒ 400, nunca 500);
 * delega a `applyReview(action:'save')` que faz gate de POOL + decideReview (nota/comentário/
 * auto-avaliação) + upsert. DELETE: apaga a própria (idempotente). GET: COOKIE-FREE/cacheável
 * (sem requireSession, sem no-store) — agregado + lista pública; fora do pool ⇒ 404 leak-safe.
 *
 * #365 (FOTO, upload/câmera, SEM IA): quando o corpo é `multipart/form-data` a avaliação carrega
 * uma foto do prato. O border VALIDA tipo+tamanho ANTES de ler os bytes, depois RE-ENCODA via
 * `sharp` (webp, `.rotate()`) — isso DESCARTA todo EXIF/GPS (a foto é servida pública, não pode
 * vazar a localização da cozinha). Só o cano de BLOB do `ImageStore` é reusado: NUNCA vira
 * `recipe_image`/`lineage_id`/proveniência, NENHUMA rota/affordance de gerar por IA.
 *
 * Códigos de erro são chaves (i18n na UI): `dados_invalidos` (400), `auto_avaliacao` (422),
 * `not_found` (404), `nao_autenticado`/`conta_desativada` (401 via requireSession),
 * `tipo_invalido`/`arquivo_grande` (400, foto), `storage_indisponivel` (503, foto).
 */

export const runtime = 'nodejs' // postgres-js + sharp/Buffer exigem Node, não Edge.

/** Cap de tamanho do upload (2 MB) — espelha o avatar (#126); o cliente já redimensiona antes. */
const MAX_BYTES = 2 * 1024 * 1024
/** Allowlist de content-type ACEITO na foto (heic/gif/svg → 400 tipo_invalido). Reforço server. */
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Resolve o descritor de FOTO (#365) a partir do corpo `multipart`. Devolve também o `rating`/
 * `comment` extraídos. VALIDA tipo+tamanho ANTES de ler os bytes (C9 — evita 2ª cópia em memória
 * de arquivo grande) e RE-ENCODA via sharp (C1 — strip de EXIF/GPS). `null` de erro vira Response.
 */
async function parseMultipart(
  request: Request,
): Promise<
  | { ok: true; rating: number; comment: unknown; photo: ReviewPhoto }
  | { ok: false; response: Response }
> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return { ok: false, response: Response.json({ error: 'dados_invalidos' }, { status: 400 }) }
  }

  const ratingRaw = form.get('rating')
  const rating = typeof ratingRaw === 'string' ? Number(ratingRaw) : NaN
  const commentRaw = form.get('comment')
  const comment = typeof commentRaw === 'string' ? commentRaw : undefined
  const removePhoto = form.get('removePhoto')
  const wantsClear = removePhoto === '1' || removePhoto === 'true'

  const file = form.get('file')
  if (file instanceof File && file.size > 0) {
    // C9: valida ANTES do arrayBuffer/sharp (não materializa o arquivo grande em memória).
    if (!ALLOWED_TYPES.has(file.type)) {
      return { ok: false, response: Response.json({ error: 'tipo_invalido' }, { status: 400 }) }
    }
    if (file.size > MAX_BYTES) {
      return { ok: false, response: Response.json({ error: 'arquivo_grande' }, { status: 400 }) }
    }
    // C1: re-encoda pra webp com `.rotate()` (assa a orientação EXIF) — sharp DESCARTA todo o
    // metadata (sem `.withMetadata()`), então GPS/EXIF NÃO vazam na foto pública.
    let clean: Buffer
    try {
      clean = await sharp(Buffer.from(await file.arrayBuffer())).rotate().webp({ quality: 82 }).toBuffer()
    } catch {
      // Bytes que o sharp não decodifica (arquivo corrompido / não-imagem com type forjado) → 400.
      return { ok: false, response: Response.json({ error: 'tipo_invalido' }, { status: 400 }) }
    }
    return { ok: true, rating, comment, photo: { kind: 'set', data: clean, contentType: 'image/webp' } }
  }

  return { ok: true, rating, comment, photo: wantsClear ? { kind: 'clear' } : { kind: 'keep' } }
}

async function handleSave(request: Request, id: string): Promise<Response> {
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  // Ramifica por content-type: multipart traz FOTO; JSON (default) é o caminho sem-foto de sempre.
  let rating: number
  let comment: unknown
  let photo: ReviewPhoto
  if ((request.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    const parsed = await parseMultipart(request)
    if (!parsed.ok) return parsed.response
    rating = parsed.rating
    comment = parsed.comment
    photo = parsed.photo
  } else {
    const body = (await request.json().catch(() => ({}))) as { rating?: unknown; comment?: unknown }
    rating = typeof body.rating === 'number' ? body.rating : NaN
    comment = body.comment
    photo = { kind: 'keep' }
  }

  const store = getImageStore()
  const res = await applyReview({
    db: getDb(),
    id,
    userId: g.session.user.id,
    action: 'save',
    rating,
    comment,
    photo,
    store,
  })

  switch (res.kind) {
    case 'ok': {
      // C4: apaga o blob SUPERSEDED (troca/remoção de foto) — best-effort, só o que é NOSSO.
      if (res.prevPhotoUrl && res.prevPhotoUrl !== res.finalPhotoUrl && store.owns(res.prevPhotoUrl)) {
        try {
          await store.delete(res.prevPhotoUrl)
        } catch {
          // órfão tolerável — a avaliação já foi salva.
        }
      }
      return Response.json(
        {
          average: res.average,
          count: res.count,
          viewerRating: res.viewerRating,
          viewerComment: res.viewerComment,
        },
        { status: 200 },
      )
    }
    case 'invalid_rating':
    case 'invalid_comment':
      return Response.json({ error: 'dados_invalidos' }, { status: 400 })
    case 'auto_review':
      return Response.json({ error: 'auto_avaliacao' }, { status: 422 })
    case 'storage_error':
      return Response.json({ error: 'storage_indisponivel' }, { status: 503 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  return handleSave(request, id)
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  return handleSave(request, id)
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const store = getImageStore()
  const res = await applyReview({ db: getDb(), id, userId: g.session.user.id, action: 'delete' })
  switch (res.kind) {
    case 'ok': {
      // C11: só apaga o blob se a linha foi REALMENTE deletada (deletedPhotoUrl preenchido). Em
      // delete no-op / linha moderada, `deletedPhotoUrl` é null ⇒ a foto persiste (como #366).
      if (res.deletedPhotoUrl && store.owns(res.deletedPhotoUrl)) {
        try {
          await store.delete(res.deletedPhotoUrl)
        } catch {
          // órfão tolerável — a avaliação já foi apagada.
        }
      }
      return Response.json(
        { average: res.average, count: res.count, viewerRating: null, viewerComment: null },
        { status: 200 },
      )
    }
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
    // save-only kinds nunca ocorrem no delete; exaustividade satisfeita.
    default:
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const res = await loadRecipeReviews(getDb(), { id })
  if (res == null) return Response.json({ error: 'not_found' }, { status: 404 })

  return Response.json({ average: res.average, count: res.count, reviews: res.reviews })
}
