'use client'
/**
 * Indicação visível de que as Restrições pré-marcadas vieram do perfil (ADR-0041) — o default nunca age sem
 * aviso. Renderiza só quando `visivel`. `comLink` mostra "Editar no perfil"; os caminhos de dentro do drawer
 * de criação não o usam (navegar para fora no meio de um pedido perderia o que foi digitado).
 */
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'

export function RestricoesPerfilHint({
  visivel,
  comLink = false,
  id,
}: {
  visivel: boolean
  comLink?: boolean
  /** Para o grupo de chips apontar para a dica (`aria-describedby`) — o leitor de tela ouve a origem junto. */
  id?: string
}) {
  const { messages } = useLocale()
  const m = messages.restricoesPerfil
  if (!visivel) return null
  return (
    <p id={id} className="text-xs text-muted">
      {m.vemDoPerfil}
      {comLink && (
        <>
          {' '}
          <Link href="/me/profile" className="font-medium text-brand-ink underline-offset-2 hover:underline">
            {m.editarNoPerfil}
          </Link>
        </>
      )}
    </p>
  )
}
