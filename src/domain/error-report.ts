/**
 * Linha estruturada de erro (issue #590, ADR-0048). Núcleo PURO e edge-safe (sem `node:*`, sem React, sem
 * `window`): o `onRequestError` do `src/instrumentation.ts` roda em todos os runtimes, e o mesmo código
 * sanitiza o relato do navegador DUAS vezes — no cliente (`@/lib/client-error-report`, antes de enviar) e de
 * novo no servidor (`/api/client-errors`, que não confia em nada do corpo).
 *
 * O que a linha carrega: a ROTA como definida no app (nunca a URL pedida — `request.path` traz a query, e a
 * query do reset de senha é um token), o método, o tipo/fonte do render, o NOME do erro, um código curto
 * (SQLSTATE/código do Node) e o digest. O digest é a ponte para a stack: o Next já loga mensagem+stack do
 * mesmo erro, e a nossa linha é o índice pesquisável que aponta para ela. Do servidor NUNCA sai mensagem;
 * do cliente sai uma mensagem curta e sanitizada só quando não há digest (erro nascido no navegador).
 *
 * Toda sanitização é por ALLOWLIST ou por regex linear sobre um texto já cortado em 1000 caracteres, e é
 * idempotente (`f(f(x)) === f(x)`): o servidor re-sanitiza o que o cliente já sanitizou sem mudar nada.
 */
// Import relativo: o E2E (`e2e/fixtures/test.ts`) importa este módulo fora do bundler do Next.
import { canonicalLocale } from '../i18n/locale'

const ERROR_LOG_TAG = '[erro]'

/** Teto da `msg` do cliente na linha (com o `…` incluso). */
export const ERROR_MESSAGE_MAX = 160
/** Corte ANTES das regex: nenhuma passa de O(n) num texto deste tamanho, e uma mensagem de 10 KB não pesa. */
const ERROR_MESSAGE_SCAN_MAX = 1000
/** Teto, em caracteres, da rota do SERVIDOR (a do cliente capa por número de segmentos). */
const ERROR_ROUTE_MAX = 160
/** Teto de segmentos da rota do cliente (o app mais fundo tem 4 sob o locale). */
const CLIENT_ROUTE_SEGMENTS_MAX = 8

/**
 * Limites do relato do navegador (ADR-0048 dec 4). Os do endpoint vivem aqui para o ADR e os testes lerem um
 * lugar só.
 */
export const CLIENT_ERROR_LIMITS = {
  /** Corpo do POST, em bytes. Um relato real tem ~300. */
  bodyMaxBytes: 2048,
  /**
   * Rajada por IP (IPv6 pela /64): 5 requests a cada 10 s, best-effort por instância. Cabe a rajada legítima
   * (boundary + rejeição no mesmo segundo, #418 seguido de #423) — o navegador já contou esses relatos nos
   * tetos dele e não reenvia — e fica bem abaixo do teto da instância: um IP sozinho não o enche.
   */
  perIpBurst: 5,
  perIpWindowMs: 10_000,
  /** Teto de LINHAS por instância por minuto, somando todos os IPs (request inválido não gasta). */
  perInstancePerMinute: 60,
  /** Relatos por carga de página (o navegador para de enviar depois disso). */
  perPageLoad: 5,
  /** Relatos por sessão do navegador (sessionStorage; bloqueado ⇒ só o teto por carga). */
  perSession: 20,
} as const

// #418/#423/#425 são os códigos minificados de produção. O `.*` volta atrás a cada `hydrat…`: num texto
// grande e sem fim é quadrático (17 s em 600 KB), por isso só roda sobre o corte de `isHydrationError`.
const HYDRATION_ERROR_RE = /Minified React error #(418|423|425)\b|Hydration failed|hydrat(ion|ing).*(mismatch|error)/i

/**
 * Erro de hidratação do React? O MESMO teste do guarda de console do E2E (`e2e/fixtures/test.ts` importa
 * daqui). Olha só os primeiros 1000 caracteres: o texto vem do navegador, sem teto.
 */
export function isHydrationError(message: string): boolean {
  return HYDRATION_ERROR_RE.test(message.slice(0, ERROR_MESSAGE_SCAN_MAX))
}

// ─── Campos curtos ────────────────────────────────────────────────────────────────────────────────

const ERROR_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,40}$/
const DIGEST_RE = /^\d{1,20}(@E\d{1,6})?$/
const ERROR_CODE_RE = /^[A-Z0-9_]{2,32}$/
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const ROUTE_TYPES = new Set(['render', 'route', 'action', 'proxy'])
const RENDER_SOURCES = new Set(['react-server-components', 'react-server-components-payload', 'server-rendering'])
const REVALIDATE_REASONS = new Set(['stale', 'on-demand'])

/** Nome cru de um valor lançado: `name` de um objeto tipo Error; senão o `typeof` (`throw 'x'` ⇒ `string`). */
export function errorNameOf(err: unknown): string {
  if (err !== null && typeof err === 'object') {
    const name = (err as { name?: unknown }).name
    if (typeof name === 'string') return name
  }
  return typeof err
}

/** Mensagem crua de um valor lançado: `throw 'x'` ⇒ `x`; `message` string de um objeto; senão `''`. */
export function errorMessageOf(err: unknown): string {
  if (typeof err === 'string') return err
  const m = (err as { message?: unknown } | null)?.message
  return typeof m === 'string' ? m : ''
}

/** Nome do erro só se parecer identificador (`TypeError`, `DrizzleQueryError`); qualquer outra coisa vira `Error`. */
export function sanitizeErrorName(name: unknown): string {
  return typeof name === 'string' && ERROR_NAME_RE.test(name) ? name : 'Error'
}

/** Digest do Next (`\d+` ou `\d+@E\d+`) ou `-`. */
export function sanitizeDigest(digest: unknown): string {
  return typeof digest === 'string' && DIGEST_RE.test(digest) ? digest : '-'
}

/**
 * Código curto do erro (ADR-0048 dec 2): SQLSTATE do Postgres (`23505`), código do Node (`ECONNREFUSED`).
 * Olha o próprio erro e, um nível abaixo, a `cause` (o Drizzle embrulha o erro do driver). Fora do formato ⇒
 * `null` (a chave some da linha). Regra do ADR-0048: `code` nunca carrega dado de usuário — é constante de
 * biblioteca.
 */
export function errorCodeOf(err: unknown): string | null {
  for (const v of [err, (err as { cause?: unknown } | null)?.cause]) {
    if (v === null || typeof v !== 'object') continue
    const code = (v as { code?: unknown }).code
    const s = typeof code === 'number' ? String(code) : code
    if (typeof s === 'string' && ERROR_CODE_RE.test(s)) return s
  }
  return null
}

/**
 * `erro=<nome saneado>[ codigo=<código>]` — o par do ADR-0048 para as linhas de log com tag própria (fora do
 * `[erro]`: `[account-purge]`, `[retencao]`, `[notification]`…). Nunca carrega mensagem nem stack: a mensagem
 * de um erro do driver traz a query com os parâmetros, e a do SDK pode trazer o texto do usuário.
 */
export function errorLogFields(err: unknown): string {
  const code = errorCodeOf(err)
  return [`erro=${sanitizeErrorName(errorNameOf(err))}`, ...(code ? [`codigo=${code}`] : [])].join(' ')
}

export function sanitizeMethod(method: unknown): string {
  const m = typeof method === 'string' ? method.toUpperCase() : ''
  return METHODS.has(m) ? m : 'OUTRO'
}

function fromSet(set: Set<string>, v: unknown): string | null {
  return typeof v === 'string' && set.has(v) ? v : null
}

// ─── Rotas ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Rota do SERVIDOR: o `routePath` do contexto do Next é a DEFINIÇÃO da rota, não a URL pedida — na prática a
 * forma normalizada (`/[locale]/recipes/[id]`, `/[locale]/admin`, `/api/u/[handle]`; em alguns caminhos do Next
 * vem a do arquivo, com grupo e `/page`). Mesmo assim: corta em `?`/`#`, troca o que não for da allowlist por
 * `_` e capa — a linha nunca quebra nem ganha chave forjada.
 */
export function sanitizeRoutePath(routePath: unknown): string {
  if (typeof routePath !== 'string') return '-'
  const cut = routePath.split(/[?#]/, 1)[0].slice(0, ERROR_ROUTE_MAX)
  const clean = cut.replace(/[^A-Za-z0-9_\-[\]().@/]/g, '_')
  return clean === '' ? '-' : clean
}

/**
 * Árvore dos segmentos ESTÁTICOS sob `src/app/[locale]` (grupos `(…)` achatados). `*` é o filho dinâmico
 * (`[id]`, `[handle]`…). `test/ui/route-segments-allowlist.test.ts` varre o diretório e exige igualdade nos
 * dois sentidos: página nova sem entrada aqui reprova o teste (e a rota sairia como `[param]`).
 */
type RouteNode = { readonly [segment: string]: RouteNode }
export const CLIENT_ROUTE_TREE: RouteNode = {
  admin: {
    catalog: {},
    comparador: {},
    descoberta: {},
    ia: {},
    moderation: {},
    plano: {},
    site: {},
    translations: {},
    users: {},
    vocabulario: {},
  },
  conversation: { '*': {} },
  cooks: {},
  create: {},
  following: {},
  'forgot-password': {},
  guia: {},
  me: {
    'meal-plan': {},
    pantry: {},
    profile: {},
    recipes: {},
    saved: {},
    'shopping-lists': { '*': {} },
  },
  plano: {},
  privacidade: {},
  recipes: { '*': {} },
  'reset-password': {},
  'seus-direitos': {},
  'sign-in': {},
  'sign-up': {},
  termos: {},
  u: { '*': {} },
  'verify-email': {},
}

const EMPTY_NODE: RouteNode = {}

/**
 * Rota do CLIENTE (o `location.pathname` do navegador, ou a rota que o cliente mandou): só a FORMA. Sem
 * query/hash; o 1º segmento vira `[locale]` (locale suportado, ou o próprio `[locale]` — idempotência) ou
 * `[sem-locale]` (não `[?]`: o `?` viraria início de query na re-normalização); os demais ficam só se
 * forem filho estático do nó atual da árvore, senão `[param]` — um slug de Receita, um handle (`/u/maria` ⇒
 * `/u/[param]`, inclusive `/u/me`), um id. No máximo 8 segmentos. Não-string ⇒ `-`. Toda busca é por
 * chave PRÓPRIA (`canonicalLocale` usa `Map`, a árvore `Object.hasOwn`): `/__proto__/constructor` não acha
 * nada herdado do `Object.prototype`.
 */
export function normalizeClientRoute(pathname: unknown): string {
  if (typeof pathname !== 'string') return '-'
  const path = pathname.slice(0, 2048).split(/[?#]/, 1)[0]
  const segments = path.split('/').filter((s) => s !== '')
  if (segments.length === 0) return '/'
  const out: string[] = []
  const [first, ...rest] = segments
  out.push(first === '[locale]' || canonicalLocale(first) ? '[locale]' : '[sem-locale]')
  let node: RouteNode = CLIENT_ROUTE_TREE
  for (const seg of rest) {
    if (out.length >= CLIENT_ROUTE_SEGMENTS_MAX) break
    const child = Object.hasOwn(node, seg) && seg !== '*' ? node[seg] : undefined
    if (child) {
      out.push(seg)
      node = child
    } else {
      out.push('[param]')
      node = Object.hasOwn(node, '*') ? node['*'] : EMPTY_NODE
    }
  }
  return `/${out.join('/')}`
}

// ─── Mensagem (só cliente) ───────────────────────────────────────────────────────────────────────

// Controles C0/C1, separadores de linha/parágrafo Unicode, zero-width e bidi: viram espaço (uma linha só, e
// nada de texto que se reordena no terminal de quem lê o log).
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g
const REACT_MINIFIED_RE = /Minified React error #(\d{1,4})/
const DOUBLE_QUOTED_RE = /"[^"]*"|\u201c[^\u201d]*\u201d/g
const SINGLE_QUOTED_RE = /'([^']*)'/g
const BACKTICK_RE = /`[^`]*`/g
// Exceção das aspas simples: `(reading 'title')` — nome de propriedade do código, não dado de usuário.
const PROPERTY_CONTEXT_RE = /(?:reading|setting|property) $/
const IDENTIFIER_RE = /^[A-Za-z_$][\w$.]{0,40}$/
// Chave forjada e tag forjada: `msg` não pode trazer `origem=servidor`, `tipo=hidratacao`, `digest=…` nem
// `[erro]` que casem as buscas por substring de `docs/observabilidade.md`. `[erro]` vira `(erro)` logo no
// começo; `=` vira `:` só no FIM, depois do token (o `TOKEN_RE` inclui `=`: trocar antes partiria
// `sid=<segredo>` e o padding base64 em pedaços curtos que escapariam da máscara).
const KEY_VALUE_RE = /=/g
const TAG_RE = /\[erro\]/gi
const URL_RE = /\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s"'<>]*/gi
// Caminho solto (`/pt-BR/u/maria?token=…`, `./u/maria`, `../u/maria`, `~/maria`): pode carregar handle, slug
// ou token. O prefixo `.`/`..`/`~` some junto.
const PATH_RE = /(^|[\s(=:,])(?:\.{1,2}|~)?\/[^\s"'<>]+/g
// Unicode (`maría@exemplo.com`, `joao@café.com.br`): com o `\w` ASCII sobrava `marí`.
const EMAIL_RE = /[\p{L}\p{N}_.+%-]{1,64}@[\p{L}\p{N}_-]{1,63}(?:\.[\p{L}\p{N}_-]{1,63})+/gu
// O que sobrou com `@` depois do e-mail: `maria@gmail` (sem TLD) ⇒ `<email>`; `@maria_silva` solto ⇒ `<handle>`.
// O lookbehind só deixa começar no início de uma palavra, então cada palavra é varrida uma vez (linear).
const AT_WORD_RE = /(?<![^\s"'`<>()[\]{},;])[^\s"'`<>()[\]{},;]*@[^\s"'`<>()[\]{},;]*/gu
// Pacote com escopo / alias de import (`@radix-ui/react-dialog`, `@/components/x`): é código, não handle.
const SCOPED_PACKAGE_RE = /^@[\w.-]*\//
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const TOKEN_RE = /[A-Za-z0-9_\-+/=.]{24,}/g
const NUMBER_RE = /\+?\(?\d[\d\s().\-/]{2,}\d/g

/**
 * Mensagem de erro do NAVEGADOR, sem dado pessoal: o que sobra é a forma ("Cannot read properties of
 * undefined (reading 'title')"), nunca o conteúdo. Heurística (ADR-0048): por isso a regra de código é não
 * interpolar dado de usuário em `throw new Error(…)` no cliente — a sanitização é a rede, não o contrato.
 *
 * Ordem: corta em 1000 → `Minified React error #N` vira `React #N` (o resto são args da URL do React) →
 * controles viram espaço → `[erro]` vira `(erro)` (nada de tag forjada) → texto entre
 * aspas some (duplas e crases sempre; simples também, exceto o identificador curto depois de
 * `reading `/`setting `/`property `) → URL, caminho, e-mail, palavra com `@` (`<email>`/`<handle>`), UUID,
 * token, número longo → `=` vira `:` (nada de chave forjada) → espaços colapsados → ≤160 com `…`.
 */
export function sanitizeErrorMessage(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return ''
  let s = raw.slice(0, ERROR_MESSAGE_SCAN_MAX)
  const react = REACT_MINIFIED_RE.exec(s)
  if (react) return `React #${react[1]}`
  s = s
    .replace(CONTROL_RE, ' ')
    .replace(TAG_RE, '(erro)')
    .replace(DOUBLE_QUOTED_RE, '"…"')
    .replace(BACKTICK_RE, '`…`')
    .replace(SINGLE_QUOTED_RE, (m: string, inner: string, offset: number, all: string) =>
      IDENTIFIER_RE.test(inner) && PROPERTY_CONTEXT_RE.test(all.slice(Math.max(0, offset - 9), offset))
        ? m
        : "'…'",
    )
    .replace(URL_RE, '<url>')
    .replace(PATH_RE, '$1<url>')
    .replace(EMAIL_RE, '<email>')
    .replace(AT_WORD_RE, (m: string) =>
      m === '@' || SCOPED_PACKAGE_RE.test(m) ? m : m.startsWith('@') ? '<handle>' : '<email>',
    )
    .replace(UUID_RE, '<id>')
    .replace(TOKEN_RE, '<token>')
    .replace(NUMBER_RE, (m: string) => (m.replace(/\D/g, '').length >= 4 ? '<num>' : m))
    .replace(KEY_VALUE_RE, ':')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > ERROR_MESSAGE_MAX ? `${s.slice(0, ERROR_MESSAGE_MAX - 1).trimEnd()}…` : s
}

// ─── Linhas ──────────────────────────────────────────────────────────────────────────────────────

/** Subconjunto do `RequestErrorContext` do Next que a linha usa (tudo opcional e re-validado). */
export type ServerErrorContext = {
  routePath?: unknown
  routeType?: unknown
  renderSource?: unknown
  revalidateReason?: unknown
}

/**
 * Linha do SERVIDOR (`console.error`), uma por erro que o Next entrega ao `onRequestError`:
 * `[erro] origem=servidor rota=/[locale]/recipes/[id] metodo=GET tipo=render fonte=server-rendering
 * erro=TypeError codigo=23505 digest=2738485511@E394`. Sem mensagem, sem path pedido, sem header.
 * `revalidacao=` só quando o Next informa; `codigo=` só quando casa o formato.
 */
export function formatServerErrorLine(err: unknown, method: unknown, ctx: ServerErrorContext): string {
  const reval = fromSet(REVALIDATE_REASONS, ctx.revalidateReason)
  const digest = sanitizeDigest((err as { digest?: unknown } | null)?.digest)
  return [
    ERROR_LOG_TAG,
    'origem=servidor',
    `rota=${sanitizeRoutePath(ctx.routePath)}`,
    `metodo=${sanitizeMethod(method)}`,
    `tipo=${fromSet(ROUTE_TYPES, ctx.routeType) ?? '-'}`,
    `fonte=${fromSet(RENDER_SOURCES, ctx.renderSource) ?? '-'}`,
    ...(reval ? [`revalidacao=${reval}`] : []),
    errorLogFields(err),
    `digest=${digest}`,
  ].join(' ')
}

/** De onde veio o relato do navegador. */
const CLIENT_ERROR_KINDS = ['boundary', 'global', 'janela', 'promessa', 'hidratacao'] as const
export type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number]

/** Relato do navegador, schema v1 — o corpo do POST e o que a linha imprime. */
export type ClientErrorReport = {
  v: 1
  tipo: ClientErrorKind
  rota: string
  erro: string
  digest: string
  /** Só sem digest; `''` = sem mensagem. */
  msg: string
}

/**
 * Monta (e sanitiza) o relato a partir do erro e do pathname. Com digest (erro de Server Component) a
 * mensagem é a genérica do Next, então nem vai; o digest basta para achar a stack no log do servidor.
 */
export function buildClientErrorReport(
  tipo: ClientErrorKind,
  err: unknown,
  pathname: unknown,
  message?: unknown,
): ClientErrorReport {
  const digest = sanitizeDigest((err as { digest?: unknown } | null)?.digest)
  const rawMsg = message ?? errorMessageOf(err)
  return {
    v: 1,
    tipo,
    rota: normalizeClientRoute(pathname),
    erro: sanitizeErrorName(errorNameOf(err)),
    digest,
    msg: digest === '-' ? sanitizeErrorMessage(rawMsg) : '',
  }
}

/**
 * Valida e RE-SANITIZA o corpo do POST (não confiável: qualquer um chama o endpoint). `{ v:1, tipo, rota,
 * erro, msg?, digest? }`; tipo fora da allowlist, campo obrigatório ausente ou de tipo errado ⇒ inválido.
 */
export function parseClientErrorReport(raw: unknown): { ok: true; value: ClientErrorReport } | { ok: false } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false }
  const r = raw as Record<string, unknown>
  if (r.v !== 1) return { ok: false }
  if (typeof r.tipo !== 'string' || !(CLIENT_ERROR_KINDS as readonly string[]).includes(r.tipo)) return { ok: false }
  if (typeof r.rota !== 'string' || typeof r.erro !== 'string') return { ok: false }
  if (r.msg !== undefined && typeof r.msg !== 'string') return { ok: false }
  if (r.digest !== undefined && typeof r.digest !== 'string') return { ok: false }
  const digest = sanitizeDigest(r.digest)
  return {
    ok: true,
    value: {
      v: 1,
      tipo: r.tipo as ClientErrorKind,
      rota: normalizeClientRoute(r.rota),
      erro: sanitizeErrorName(r.erro),
      digest,
      msg: digest === '-' ? sanitizeErrorMessage(r.msg) : '',
    },
  }
}

/**
 * Linha do CLIENTE (`console.warn` no servidor, nunca no navegador):
 * `[erro] origem=cliente rota=/[locale]/recipes/[param] tipo=hidratacao erro=Error digest=- msg="React #418"`.
 * `msg` em JSON (aspas escapadas, uma linha); ausente quando há digest ou quando ficou vazia.
 */
export function formatClientErrorLine(report: ClientErrorReport): string {
  const parts = [
    ERROR_LOG_TAG,
    'origem=cliente',
    `rota=${report.rota}`,
    `tipo=${report.tipo}`,
    `erro=${report.erro}`,
    `digest=${report.digest}`,
  ]
  if (report.digest === '-' && report.msg !== '') parts.push(`msg=${JSON.stringify(report.msg)}`)
  return parts.join(' ')
}

/** Linha única por janela quando o teto por instância estoura (o resto da janela é descartado em silêncio). */
export const CLIENT_ERROR_LIMIT_LINE = `${ERROR_LOG_TAG} origem=cliente limite=atingido`

/** Impressão digital para deduplicar no navegador (mesmo erro na mesma rota conta uma vez por carga). */
export function clientErrorFingerprint(r: ClientErrorReport): string {
  return [r.tipo, r.erro, r.msg, r.rota, r.digest].join('|')
}
