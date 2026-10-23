import { isModerationCategory, type ModerationCategory } from '@/domain/moderation-category'

/**
 * Corpo das 4 rotas de retirada do Curador (receita, só a imagem, avaliação, imagem da fila proativa):
 * `{ reason, category }`. `reason` é o texto livre (vazio aqui vira '' e o núcleo responde `invalid_reason`, como
 * antes); `category` é a categoria do motivo, da lista fechada (#609). Ausente ou fora da lista → 400
 * `categoria_invalida`, ANTES de qualquer write: o núcleo só recebe uma categoria válida. Corpo ilegível ou que não é
 * objeto (`null`, número) conta como vazio, sem 500.
 */
export type TakedownBody =
  | { ok: true; reason: string; category: ModerationCategory }
  | { ok: false; response: Response }

export async function parseTakedownBody(request: Request): Promise<TakedownBody> {
  const raw: unknown = await request.json().catch(() => null)
  const body = (raw !== null && typeof raw === 'object' ? raw : {}) as { reason?: unknown; category?: unknown }
  const reason = typeof body.reason === 'string' ? body.reason : ''
  const category = body.category
  if (!isModerationCategory(category)) {
    return { ok: false, response: Response.json({ error: 'categoria_invalida' }, { status: 400 }) }
  }
  return { ok: true, reason, category }
}
