/**
 * Handle — identificador público, único e legível do Usuário (#128, CONTEXT.md: _Handle_).
 * Endereça o perfil público (`/u/<handle>`). Lógica PURA (sem DB, sem Better Auth): slug do
 * nome, desambiguação numérica, palavras reservadas e validação de formato. A unicidade real
 * (consulta ao banco) vive na borda (auth hook + PATCH /api/me); aqui só a forma e as regras.
 *
 * Mesma tese de `access.ts`/`user.ts`: kernel puro + testável em unidade, separado do I/O.
 *
 * Regras (CONTEXT.md): minúsculo, ascii (acentos dobrados), só [a-z0-9-], sem hífen nas bordas
 * nem duplo; 3–30 chars; palavras reservadas barradas (colidiriam com rotas top-level).
 */

/** Tamanho mínimo/máximo do handle. 3 evita handles triviais; 30 cabe em URL/UI sem cortar. */
export const HANDLE_MIN_LEN = 3
export const HANDLE_MAX_LEN = 30

/**
 * Formato canônico: minúsculas, dígitos e hífens internos; precisa começar e terminar com
 * [a-z0-9] (sem hífen nas bordas). O length e o `--` consecutivo são checados à parte (a
 * regex não os cobre). Espelha o que o `slugify` produz, validado de forma independente.
 */
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/**
 * Palavras reservadas: tudo que colidiria com um segmento de rota top-level sob `app/`
 * (admin, api, me, recipes, sign-in, sign-up, conversation, create) MAIS o prefixo do perfil
 * público (`u`, `users`) e termos de navegação prováveis (settings, profile, new, edit). Barrar
 * aqui evita que um handle "sequestre" uma rota ou confunda o roteamento de `/u/<handle>`.
 * Fonte única (QM-4): consumida pelo auth hook (desambiguação pula reservadas) e pelo PATCH.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'me',
  'u',
  'users',
  'user',
  'sign-in',
  'sign-up',
  'signin',
  'signup',
  'recipes',
  'recipe',
  'create',
  'conversation',
  'settings',
  'profile',
  'new',
  'edit',
  'about',
  'help',
  'root',
  'null',
  'undefined',
])

/**
 * Normaliza um handle CRU do path (`/u/<handle>`) pra LOOKUP: trim + minúsculo (como a gravação no
 * #128). Vazio → null (o caller responde 404 sem tocar o DB útil). NÃO valida formato/reservada — é
 * só a forma de consulta (o que não casar nenhuma linha já é 404 leak-safe). Fonte ÚNICA do perfil
 * público (`/api/u/[handle]`) e da rota de seguir (#274), pra os dois NÃO divergirem em
 * case-sensitivity nem no short-circuit de vazio (senão viram oráculos de existência distintos).
 */
export function normalizeHandle(raw: string): string | null {
  const h = raw.trim().toLowerCase()
  return h.length === 0 ? null : h
}

/** Veredito de validação de um handle proposto pelo usuário. */
export type HandleValidation =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'reserved' }

/**
 * Transforma um nome livre num slug-base de handle: minúsculo, acentos dobrados pra ascii,
 * só [a-z0-9-], hífens colapsados e aparados das bordas. Pode devolver '' (nome só de símbolos);
 * o caller (auth hook) trata o fallback. NÃO garante length/reservada — é só a normalização.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD') // separa acento do caractere base (ex.: "á" → "a" + acento combinante)
    .replace(/\p{Diacritic}/gu, '') // remove os diacríticos (mesma tese de `normalizeText`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // qualquer não-alfanumérico vira hífen (espaços, símbolos, _)
    .replace(/-+/g, '-') // colapsa hífens repetidos
    .replace(/^-+|-+$/g, '') // apara hífens das bordas
}

/**
 * Valida o FORMATO + reservadas de um handle já normalizado (o que o usuário digita na tela).
 * NÃO checa unicidade (isso é I/O, vive na borda). `invalid` = length/charset errados;
 * `reserved` = bate numa palavra reservada. Não normaliza: o handle precisa já vir canônico
 * (a UI/route compara contra o que será gravado).
 */
export function validateHandle(handle: string): HandleValidation {
  if (handle.length < HANDLE_MIN_LEN || handle.length > HANDLE_MAX_LEN) {
    return { ok: false, reason: 'invalid' }
  }
  if (!HANDLE_RE.test(handle)) {
    return { ok: false, reason: 'invalid' }
  }
  // Sem hífens consecutivos: `slugify` os colapsa, então um `--` na entrada do usuário é
  // forma não-canônica (e feia em URL). Barrar mantém o handle digitado idêntico ao gerado.
  if (handle.includes('--')) {
    return { ok: false, reason: 'invalid' }
  }
  if (RESERVED_HANDLES.has(handle)) {
    return { ok: false, reason: 'reserved' }
  }
  return { ok: true }
}

/**
 * Deriva um handle-base VÁLIDO a partir de um nome, pronto pra desambiguação. Garante length
 * mínimo e que não seja reservado/curto: slugifica; se o slug ficar curto demais ou reservado,
 * cai num fallback estável ('user'). NÃO checa unicidade — só produz um candidato bem-formado.
 *
 * Trunca ao máximo PRESERVANDO espaço pro sufixo de desambiguação: deixa folga de até
 * `-NN` (reservedSuffix) para que `disambiguate` não estoure HANDLE_MAX_LEN ao anexar.
 */
export function handleBaseFromName(name: string, reservedSuffix = 6): string {
  const slug = slugify(name)
  const maxBase = HANDLE_MAX_LEN - reservedSuffix
  let base = slug.slice(0, Math.max(maxBase, HANDLE_MIN_LEN)).replace(/-+$/g, '')
  // Slug vazio/curto (nome só de símbolos ou 1–2 chars) ou reservado → fallback estável.
  if (base.length < HANDLE_MIN_LEN || RESERVED_HANDLES.has(base)) {
    base = 'user'
  }
  return base
}

/**
 * Desambiguação PURA: dado um handle-base e o conjunto de handles já EM USO, devolve o primeiro
 * disponível. Tenta o base puro; se tomado/reservado, anexa `-2`, `-3`, … até achar um livre.
 * Pula candidatos reservados também (um sufixo nunca deveria colidir, mas é fail-safe). O caller
 * monta `taken` lendo o banco — esta função não toca I/O.
 *
 * Garante o resultado dentro de HANDLE_MAX_LEN: se `base + -N` estourar, encurta o base.
 */
export function disambiguate(base: string, taken: ReadonlySet<string>): string {
  const isFree = (h: string): boolean => !taken.has(h) && !RESERVED_HANDLES.has(h)

  if (isFree(base) && base.length <= HANDLE_MAX_LEN) return base

  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    // Encurta o base se o sufixo estourar o máximo (mantém o handle sempre válido).
    const room = HANDLE_MAX_LEN - suffix.length
    const trimmedBase = base.slice(0, room).replace(/-+$/g, '') || 'user'
    const candidate = `${trimmedBase}${suffix}`
    if (isFree(candidate)) return candidate
  }
}
