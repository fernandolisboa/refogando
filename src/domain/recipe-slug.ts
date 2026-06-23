/**
 * Slug por idioma da Receita (#229, ADR-0020) — o identificador legível na URL de detalhe
 * (`/{locale}/recipes/<slug>`, nunca o UUID). Lógica PURA (sem DB): normalização do título,
 * fallback de base, desambiguação numérica DETERMINÍSTICA por (locale) e a regra de
 * CONGELAMENTO. A unicidade real (consulta `UNIQUE(locale, slug)` ao banco) vive na borda
 * (write-path da tradução + backfill); aqui só a forma e as regras.
 *
 * Espelha deliberadamente `domain/handle.ts` (slugify/handleBaseFromName/disambiguate): mesma
 * tese de kernel puro + testável em unidade, separado do I/O. Diferenças de propósito:
 *  - escopo de unicidade é o **locale** (não global): a mesma cadeia (`(locale, slug)`) é a
 *    chave única no banco; pt-BR e en-US podem ter o mesmo slug sem colidir;
 *  - sufixo de desambiguação começa em **-1** (ADR-0020 fala em "-1, -2, …"), não em -2 como o
 *    handle — escolha consciente, registrada aqui;
 *  - **sem palavras reservadas**: o slug vive SOB o prefixo de locale e o segmento `recipes/`,
 *    então não pode sequestrar uma rota top-level (ao contrário do handle em `/u/<handle>`).
 *
 * CONGELAMENTO (inegociável — ADR-0020 decisão 4): uma vez derivado, o slug NÃO muda quando o
 * título é renomeado/revisado/republicado nem quando a procedência da tradução é promovida —
 * trocar a URL custaria ranking e quebraria links. Para tradução automática, o slug en-US
 * congela a partir do título da MT **inicial** (estabilidade > beleza). `freezeSlug` é o ponto
 * único que materializa essa regra: havendo slug existente, ele é preservado; só na ausência
 * (1ª vez) deriva-se do título atual e desambigua-se.
 */

/**
 * Teto de tamanho do slug. Generoso o bastante para títulos de receita reais sem cortar
 * palavras úteis, mas limitado para manter a URL e o índice `UNIQUE(locale, slug)` enxutos.
 * O teto inclui o sufixo de desambiguação (`recipeSlugBaseFromTitle` reserva folga).
 */
export const RECIPE_SLUG_MAX_LEN = 80

/** Tamanho mínimo de um slug-base utilizável antes de cair no fallback. */
const RECIPE_SLUG_MIN_LEN = 1

/**
 * Fallback estável quando o título não produz NENHUM caractere ascii (título só de
 * símbolos/emoji ou de escrita não-latina como CJK). Genérico por design — a desambiguação
 * por sufixo garante unicidade entre vários fallbacks no mesmo locale (`receita`, `receita-1`…).
 */
const RECIPE_SLUG_FALLBACK = 'receita'

/**
 * Folga reservada no fim do base para o sufixo de desambiguação (`-NNNN`), garantindo que
 * `disambiguateSlug` nunca estoure `RECIPE_SLUG_MAX_LEN` ao anexar. 5 cobre `-9999`.
 */
const SLUG_SUFFIX_RESERVE = 5

/**
 * Normaliza um título livre num slug: minúsculo, acentos dobrados pra ascii, só [a-z0-9-],
 * hífens colapsados e aparados das bordas. Pode devolver '' (título só de símbolos/CJK); o
 * caller (`recipeSlugBaseFromTitle`) aplica o fallback. NÃO garante tamanho — é só a
 * normalização. Idêntico em espírito a `handle.slugify` (mesma cadeia NFD → strip → kebab).
 */
export function slugifyRecipeTitle(title: string): string {
  return title
    .normalize('NFD') // separa o acento do caractere base ("á" → "a" + diacrítico combinante)
    .replace(/\p{Diacritic}/gu, '') // remove os diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // qualquer não-alfanumérico vira hífen (espaços, símbolos, _)
    .replace(/-+/g, '-') // colapsa hífens repetidos
    .replace(/^-+|-+$/g, '') // apara hífens das bordas
}

/**
 * Deriva um slug-base VÁLIDO e não-vazio a partir do título, pronto pra desambiguação:
 * slugifica, trunca ao teto PRESERVANDO folga pro sufixo, e cai num fallback estável quando o
 * resultado fica vazio. NÃO checa unicidade — só produz um candidato bem-formado.
 */
export function recipeSlugBaseFromTitle(title: string): string {
  const slug = slugifyRecipeTitle(title)
  const maxBase = RECIPE_SLUG_MAX_LEN - SLUG_SUFFIX_RESERVE
  const base = slug.slice(0, Math.max(maxBase, RECIPE_SLUG_MIN_LEN)).replace(/-+$/g, '')
  // Vazio (título só de símbolos/CJK) → fallback estável.
  return base.length >= RECIPE_SLUG_MIN_LEN ? base : RECIPE_SLUG_FALLBACK
}

/**
 * Desambiguação PURA e DETERMINÍSTICA: dado um slug-base e o conjunto de slugs já EM USO no
 * mesmo (locale), devolve o primeiro disponível. Tenta o base puro; se tomado, anexa o MENOR
 * sufixo livre `-1`, `-2`, … (preenche buracos na sequência — determinístico, sem aleatório
 * nem timestamp, então re-rodar o backfill é estável). O caller monta `taken` lendo o banco;
 * esta função não toca I/O.
 *
 * Garante o resultado dentro de `RECIPE_SLUG_MAX_LEN`: se `base + -N` estourar, encurta o base.
 */
export function disambiguateSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base) && base.length <= RECIPE_SLUG_MAX_LEN) return base

  for (let n = 1; ; n++) {
    const suffix = `-${n}`
    // Encurta o base se o sufixo estourar o teto (mantém o slug sempre válido e dentro do limite).
    const room = RECIPE_SLUG_MAX_LEN - suffix.length
    const trimmedBase = base.slice(0, room).replace(/-+$/g, '') || RECIPE_SLUG_FALLBACK
    const candidate = `${trimmedBase}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Ponto ÚNICO da regra de CONGELAMENTO (ADR-0020 decisão 4). Materializa o slug a persistir para
 * uma tradução:
 *  - se já existe um slug congelado (`existingSlug` não-vazio), PRESERVA — renomear/revisar/
 *    republicar NÃO muda a URL; en-US não re-deriva quando a MT é revisada;
 *  - se não existe (1ª vez — o congelamento), deriva do título ATUAL e desambigua contra
 *    `taken` (os slugs já em uso naquele locale).
 *
 * Determinística e idempotente: re-chamar com o mesmo `existingSlug` devolve-o inalterado, então
 * é seguro no backfill e em qualquer re-save.
 */
export function freezeSlug(input: {
  existingSlug?: string | null
  title: string
  taken: ReadonlySet<string>
}): string {
  const { existingSlug, title, taken } = input
  if (existingSlug != null && existingSlug.length > 0) return existingSlug
  return disambiguateSlug(recipeSlugBaseFromTitle(title), taken)
}

/** Uma linha de tradução, do ponto de vista do backfill: o mínimo para derivar o slug. */
export type TranslationSlugRow = {
  id: string
  locale: string
  titulo: string
  slug: string | null
}

/** Uma atribuição de slug a aplicar (UPDATE de UMA linha que estava com slug NULL). */
export type SlugAssignment = { id: string; locale: string; slug: string }

/**
 * Núcleo PURO do backfill (#229): dada a lista de traduções JÁ ORDENADA de forma estável
 * (o caller ordena por `(locale, created_at, id)` no SQL), devolve as atribuições de slug SÓ
 * para as linhas que ainda estão com `slug` NULL — preservando as que já têm slug e
 * desambiguando POR locale com o menor sufixo livre.
 *
 * Determinística e idempotente: as linhas já preenchidas SEMENTEIAM o `taken` (não reentram
 * na disputa) e nunca são reatribuídas, então re-rodar com o estado pós-backfill devolve uma
 * lista VAZIA. Separa a regra do I/O: o script e o teste de integração exercitam ESTA função;
 * o I/O (SELECT ordenado + UPDATE guardado) é a casca fina ao redor.
 */
export function computeSlugBackfill(rows: readonly TranslationSlugRow[]): SlugAssignment[] {
  const takenByLocale = new Map<string, Set<string>>()
  const takenFor = (locale: string): Set<string> => {
    let s = takenByLocale.get(locale)
    if (!s) {
      s = new Set<string>()
      takenByLocale.set(locale, s)
    }
    return s
  }

  // 1ª passada: semeia o `taken` por locale com os slugs JÁ gravados (preservados, não re-derivados).
  for (const r of rows) {
    if (r.slug != null && r.slug.length > 0) takenFor(r.locale).add(r.slug)
  }

  // 2ª passada (na ordem estável recebida): só as linhas SEM slug ganham um, desambiguado.
  const assignments: SlugAssignment[] = []
  for (const r of rows) {
    if (r.slug != null && r.slug.length > 0) continue
    const taken = takenFor(r.locale)
    const slug = disambiguateSlug(recipeSlugBaseFromTitle(r.titulo), taken)
    taken.add(slug)
    assignments.push({ id: r.id, locale: r.locale, slug })
  }
  return assignments
}
