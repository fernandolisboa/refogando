'use client'
/**
 * Botão Seguir COMPACTO do trilho "Cozinheiros pra seguir" (#278) — versão densa do botão do perfil
 * (`ProfileFollowSection`), SEM contador de seguidores e SEM GET-no-mount: o trilho já EXCLUI os
 * já-seguidos no servidor, então todo item nasce "não-seguindo" (`initialFollowing=false`) e o estado é
 * semeado por prop (zero fetch por item — evita N requisições num trilho de N cartões).
 *
 * Reusa o seam `useFollowToggle` (mesma lógica otimista + revert do perfil). Otimismo no clique; no erro
 * reverte e mostra um aviso neutro curto. NÃO remove o cartão ao seguir (evita salto de layout) — só
 * troca o rótulo pra "Seguindo".
 */
import { Button } from '@/components/ui/button'
import { useFollowToggle } from '@/hooks/use-follow-toggle'

export type CookFollowLabels = {
  seguir: string
  seguindo: string
  erroSeguir: string
}

export function CookFollowButton({
  handle,
  initialFollowing = false,
  labels,
}: {
  handle: string
  initialFollowing?: boolean
  labels: CookFollowLabels
}) {
  const { isFollowing, busy, error, toggle } = useFollowToggle({ handle, initialFollowing })

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        variant={isFollowing ? 'default' : 'secondary'}
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={isFollowing}
        aria-busy={busy}
        className="disabled:opacity-70"
      >
        {isFollowing ? labels.seguindo : labels.seguir}
      </Button>
      {error && (
        <span role="alert" className="text-xs font-medium text-fg">
          {labels.erroSeguir}
        </span>
      )}
    </div>
  )
}
