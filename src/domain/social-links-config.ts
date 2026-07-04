/**
 * Links de redes sociais do SITE (#451) — renderizados no footer, geridos pelo Admin sem deploy.
 * PURO: tipos + defaults + validação. Espelha a forma dos demais configs do singleton `app_config`
 * (`catalog-disclosure-config`/`web-search-config`/…): fonte ÚNICA compartilhada pela leitura
 * (server → footer) e pelo PUT do admin.
 *
 * DISTINTO dos links do PERFIL (`links.ts`, `LINK_TIPOS`): aquilo é o perfil de um usuário; isto é a
 * presença de marca do próprio site. São superfícies diferentes, com allowlists próprias. O que se
 * REUSA (deliberadamente, para não ter duas fontes de verdade de segurança) é o `safeHttpUrl` —
 * mesma defesa contra `javascript:`/`data:`/protocol-relative que já protege o perfil público.
 *
 * Forma de cada link: `{ platform, url, label?, enabled }`.
 *  - `platform`: allowlist FECHADA em código (muda mais rápido que uma migração).
 *  - `url`: http(s) segura (via `safeHttpUrl`).
 *  - `label`: nome de exibição opcional; ausente ⇒ usa `PLATFORM_DISPLAY[platform]`.
 *  - `enabled`: permite o admin CADASTRAR uma conta hoje e LIGÁ-LA quando existir ("redes futuras").
 */
import { safeHttpUrl } from '@/domain/links'

/** Allowlist fechada de plataformas. Fonte única consumida pela UI admin e pela validação da borda. */
export const SOCIAL_PLATFORMS = [
  'instagram',
  'x',
  'tiktok',
  'youtube',
  'facebook',
  'pinterest',
  'threads',
  'bluesky',
] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

/** Um link social do site: plataforma conhecida + URL http(s) + rótulo opcional + liga/desliga. */
export type SocialLink = {
  platform: SocialPlatform
  url: string
  /** Nome de exibição opcional; ausente ⇒ `PLATFORM_DISPLAY[platform]`. */
  label?: string
  enabled: boolean
}

export type SocialLinksConfig = SocialLink[]

/** Teto de links (mantém o footer são). Acima disso a lista inteira é recusada. */
export const SOCIAL_LINKS_MAX = 8
/** Teto do rótulo opcional. Medido após trim. */
export const SOCIAL_LABEL_MAX_LEN = 40

/**
 * Default: lista VAZIA. Fail-safe — o footer renderiza exatamente como hoje (sem links) até o admin
 * cadastrar. Reversível pela `/admin/site`.
 */
export const DEFAULT_SOCIAL_LINKS_CONFIG: SocialLinksConfig = []

/**
 * Nome de exibição por plataforma. É NOME DE MARCA — não se traduz (sem i18n). Usado quando o link
 * não traz `label` próprio.
 */
export const PLATFORM_DISPLAY: Record<SocialPlatform, string> = {
  instagram: 'Instagram',
  x: 'X',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  facebook: 'Facebook',
  pinterest: 'Pinterest',
  threads: 'Threads',
  bluesky: 'Bluesky',
}

const PLATFORMS = new Set<string>(SOCIAL_PLATFORMS)
function isSocialPlatform(v: unknown): v is SocialPlatform {
  return typeof v === 'string' && PLATFORMS.has(v)
}

export type SocialLinksConfigParse = { ok: true; value: SocialLinksConfig } | { ok: false }

/**
 * Valida a lista crua do PUT (substituição COMPLETA — a UI sempre envia a lista inteira). Regras, em
 * ordem:
 *  - precisa ser array (`{ ok:false }`); lista vazia é VÁLIDA (footer limpo);
 *  - no máximo `SOCIAL_LINKS_MAX` entradas;
 *  - cada entrada é objeto com `platform` na allowlist;
 *  - SEM plataforma duplicada (um link por rede);
 *  - `url` http(s) segura via `safeHttpUrl` (mata `javascript:`/`data:`/`//host`);
 *  - `label` opcional: string trimada; vazia ⇒ omitida; acima do teto ⇒ recusa;
 *  - `enabled` boolean obrigatório.
 * A ORDEM do array é preservada (= ordem de render no footer). PURO: sem DB/I/O.
 */
export function parseSocialLinksConfig(raw: unknown): SocialLinksConfigParse {
  if (!Array.isArray(raw)) return { ok: false }
  if (raw.length > SOCIAL_LINKS_MAX) return { ok: false }

  const seen = new Set<SocialPlatform>()
  const value: SocialLinksConfig = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return { ok: false }
    const obj = entry as { platform?: unknown; url?: unknown; label?: unknown; enabled?: unknown }
    if (!isSocialPlatform(obj.platform)) return { ok: false }
    if (seen.has(obj.platform)) return { ok: false }
    if (typeof obj.enabled !== 'boolean') return { ok: false }
    const url = safeHttpUrl(obj.url)
    if (url === null) return { ok: false }

    let label: string | undefined
    if (obj.label !== undefined) {
      if (typeof obj.label !== 'string') return { ok: false }
      const trimmed = obj.label.trim()
      if (trimmed.length > SOCIAL_LABEL_MAX_LEN) return { ok: false }
      label = trimmed === '' ? undefined : trimmed
    }

    seen.add(obj.platform)
    const link: SocialLink = { platform: obj.platform, url, enabled: obj.enabled }
    if (label !== undefined) link.label = label
    value.push(link)
  }
  return { ok: true, value }
}
