/**
 * Iniciais para o avatar de fallback (quando `users.image` é NULL): 1ª letra das 2 primeiras
 * palavras do nome (ou só a 1ª, se houver uma). Pura e compartilhada pelo `Avatar` (#126) e pelo
 * perfil público (`public-profile-view`) — um só lugar, mesma forma.
 */
export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0)
  if (parts.length === 0) return '?'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase()
}
