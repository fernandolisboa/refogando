/**
 * Avatar reutilizável (#126) — `<img>` simples de uma URL (Vercel Blob nosso, Google OAuth, ou
 * NULL) com fallback de INICIAIS quando não há imagem. Espelha a forma visual do avatar do perfil
 * público (`public-profile-view`): círculo com borda, `object-cover`; iniciais sobre `bg-surface`.
 *
 * NÃO usa `next/image` (convenção do repo: `<img>` simples) — `images.remotePatterns` no
 * `next.config` cobre o host do blob caso um `next/image` apareça depois. `referrerPolicy` evita
 * vazar o referer pro host da imagem (o avatar do Google pede isso). As iniciais são `aria-hidden`
 * (decorativas — o nome costuma estar ao lado/no alt).
 *
 * Sem hooks: serve tanto em árvore client (auth-slot, avatar-uploader) quanto server.
 */
import { initials } from '@/lib/initials'

const SIZES = {
  sm: { box: 'h-8 w-8', text: 'text-xs' },
  // 42px — paridade com o CreatorCard do trilho "Cozinheiros em alta" (entre o sm de 32px e o lg de 80px).
  md: { box: 'h-[42px] w-[42px]', text: 'text-sm' },
  lg: { box: 'h-20 w-20', text: 'text-2xl' },
} as const

export type AvatarSize = keyof typeof SIZES

export function Avatar({
  src,
  name,
  alt,
  size = 'sm',
}: {
  src: string | null | undefined
  name: string
  alt: string
  size?: AvatarSize
}) {
  const s = SIZES[size]
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        className={`${s.box} shrink-0 rounded-full border border-border object-cover`}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={`flex ${s.box} shrink-0 items-center justify-center rounded-full border border-border bg-surface font-display ${s.text} text-muted-foreground`}
    >
      {initials(name)}
    </span>
  )
}
