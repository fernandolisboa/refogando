/**
 * Lista de Usuários do Console (aba "Usuários", admin-only) — vocabulário e regras PURAS (sem DB, sem I/O).
 *
 * O admin lista as contas por ATALHO (preset), busca por nome/@handle/email/ID e pagina. Os atalhos são um
 * enum fechado (nunca SQL vindo do cliente): o loader `server/admin/user-list` traduz cada um num WHERE fixo.
 * Email é dado pessoal: só esta lista admin o devolve, e a resposta é a allowlist `AdminUserListItem` (nunca a
 * linha crua — sem `banReason`, `restricoes`, `pantryBasics` etc.). Conta ELIMINADA (anonimizada, LGPD Art. 18
 * VI) aparece só no atalho "Desativadas", com o que sobrou da anonimização.
 */
import type { Role } from '@/domain/user'
import type { Plan } from '@/domain/plan'

/** Atalhos de filtro, na ordem da tira. `todos` é o padrão. */
export const ADMIN_USER_PRESETS = [
  'todos',
  'novos',
  'sem-papel',
  'equipe',
  'pendentes',
  'pro',
  'desativadas',
] as const
export type AdminUserPreset = (typeof ADMIN_USER_PRESETS)[number]

export const ADMIN_USER_SORTS = ['recentes', 'antigos', 'acesso', 'nome'] as const
export type AdminUserSort = (typeof ADMIN_USER_SORTS)[number]

/** "Novos" = cadastrados nos últimos N dias. */
export const NEW_USER_WINDOW_DAYS = 7

export const ADMIN_USER_PAGE_SIZE = 25

/** Teto de página: o OFFSET é server-controlled e não cresce sem limite (25 × 400 = 10 mil contas). */
export const ADMIN_USER_MAX_PAGE = 400

/**
 * Situação da conta, derivada na ordem em que uma esconde a outra: eliminada (PII destruída) > desativada
 * (bloqueada) > pendente (cadastro de email+senha ainda não provado, vai para o expurgo) > não confirmada
 * (email não provado, sem marcador de expurgo: contas antigas ou confirmação desligada) > ativa.
 */
export const ADMIN_USER_STATUSES = ['ativa', 'nao-confirmada', 'pendente', 'desativada', 'eliminada'] as const
export type AdminUserStatus = (typeof ADMIN_USER_STATUSES)[number]

export function deriveAdminUserStatus(u: {
  anonymizedAt: Date | string | null
  deletedAt: Date | string | null
  pendingSignupAt: Date | string | null
  emailVerified: boolean
}): AdminUserStatus {
  if (u.anonymizedAt != null) return 'eliminada'
  if (u.deletedAt != null) return 'desativada'
  if (u.pendingSignupAt != null) return 'pendente'
  if (!u.emailVerified) return 'nao-confirmada'
  return 'ativa'
}

export type AdminUserListQuery = {
  preset: AdminUserPreset
  q: string
  sort: AdminUserSort
  page: number
}

function pick<T extends string>(allowed: readonly T[], raw: string | null, fallback: T): T {
  return raw != null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
}

/**
 * Lê os parâmetros da URL com fallback silencioso (valor desconhecido ⇒ padrão, nunca 400): a lista é uma
 * tela de consulta e um link velho ou editado à mão deve abrir algo útil. `q` é cortado no mesmo teto da busca
 * de usuários (`classifyUserQuery` também corta; aqui só evita carregar um `q` gigante adiante).
 */
export function parseAdminUserListQuery(params: URLSearchParams): AdminUserListQuery {
  const rawPage = Number.parseInt(params.get('page') ?? '', 10)
  const page = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), ADMIN_USER_MAX_PAGE) : 1
  return {
    preset: pick(ADMIN_USER_PRESETS, params.get('preset'), 'todos'),
    q: (params.get('q') ?? '').slice(0, 128),
    sort: pick(ADMIN_USER_SORTS, params.get('sort'), 'recentes'),
    page,
  }
}

/** Uma linha da lista (allowlist explícita). Datas em ISO 8601. */
export type AdminUserListItem = {
  id: string
  name: string
  handle: string
  email: string
  image: string | null
  role: Role
  plan: Plan
  status: AdminUserStatus
  emailVerified: boolean
  locale: string | null
  createdAt: string
  /** Última atualização de uma sessão ainda guardada (o Better Auth renova a sessão no uso). null = nenhuma. */
  lastSeenAt: string | null
  /** Marcador do cadastro pendente (`users.pending_signup_at`). */
  pendingSignupAt: string | null
  /** A partir de quando o expurgo diário pode apagar a conta pendente (marcador + `PENDING_SIGNUP_MAX_AGE_MS`). */
  pendingPurgeAt: string | null
  deletedAt: string | null
  imageGenBlocked: boolean
  recipeCount: number
  publicRecipeCount: number
}

export type AdminUserListPage = {
  users: AdminUserListItem[]
  /** Total do atalho+busca atuais (para "Mostrando x–y de N"). */
  total: number
  page: number
  pageSize: number
  /** Contagem de CADA atalho, sem a busca: os números da tira. */
  counts: Record<AdminUserPreset, number>
}

/**
 * Tempo relativo curto para a tabela ("há 2 horas", "ontem"); acima de uma semana, a data. PURO: `now` e
 * `locale` entram por parâmetro (a lista carrega no cliente depois da hidratação, sem risco de divergir do SSR).
 */
export function formatRelativeTime(iso: string, now: number, locale: string): string {
  const diffS = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(diffS)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (abs < 60) return rtf.format(0, 'second')
  if (abs < 3600) return rtf.format(Math.round(diffS / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diffS / 3600), 'hour')
  if (abs < 7 * 86400) return rtf.format(Math.round(diffS / 86400), 'day')
  return formatDate(iso, locale)
}

export function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
}

export function formatDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
}

/** Horas inteiras (arredondadas para cima, mínimo 0) até `iso`. */
export function hoursUntil(iso: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 3_600_000))
}
