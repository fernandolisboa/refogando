'use client'
/**
 * Sininho da Caixa de Notificações (#371, ADR-0028) na chrome. SÓ-LOGADO + Modelo B: gateia por
 * `useSession` e retorna `null` no SSR / p/ Visitante / enquanto pendente (a home anon/indexável segue
 * byte-idêntica — nada semeado no servidor). Badge com o contador de não-lidas (some quando 0). O painel
 * é um `DropdownMenu modal={false}` (espelha o AuthSlot — zero primitiva nova): abrir dispara
 * `markAllRead()` (limpa o badge + reconcilia o contador com o server). Cada item compõe avatar do ator
 * + o texto LOCALIZADO via `renderNotification` (dado estruturado → frase no locale do leitor).
 *
 * #460: itens com alvo (`notificationHref`) viram `DropdownMenuItem asChild <Link>` — MENUITEM de
 * verdade (foco/setas/Enter do Radix + fecha-no-select automático, igual ao AuthSlot); NÃO um `<a>` nu
 * (que o Radix não registra ⇒ inalcançável por teclado). Itens sem alvo (informativos/ator degradado)
 * ficam texto puro.
 */
import Link from 'next/link'
import { BellIcon } from 'lucide-react'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar } from '@/components/profile/avatar'
import { renderNotification, notificationHref } from '@/domain/notification'
import { useNotifications } from '@/components/use-notifications'

export function NotificationBell() {
  const { locale, messages } = useLocale()
  const session = useSession()
  const authed = !session.isPending && !session.error && !!session.data
  const { notifications, unreadCount, markAllRead } = useNotifications()

  // Modelo B: nada no SSR / anon / pendente (a chrome anon fica byte-idêntica). Os hooks acima rodam
  // sempre (ordem estável); só o RENDER é gateado.
  if (!authed) return null

  const m = messages.notifications
  const badge = unreadCount > 99 ? '99+' : String(unreadCount)

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) markAllRead()
      }}
    >
      <DropdownMenuTrigger
        aria-label={m.ariaLabel}
        className="relative inline-flex size-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-brand/10 hover:text-fg"
      >
        <BellIcon aria-hidden="true" className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-brand-strong px-1 text-[0.625rem] leading-4 font-semibold text-white">
            {badge}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] w-80 overflow-y-auto p-0">
        <div className="border-b border-border px-3 py-2 text-sm font-semibold text-fg">
          {m.tituloPainel}
        </div>
        {notifications.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted">{m.vazio}</p>
        ) : (
          notifications.map((n) => {
            const href = notificationHref(n.type, n.refs, locale)
            const inner = (
              <>
                <Avatar src={n.actorImage} name={n.refs.actorName ?? ''} alt="" size="sm" />
                <span className="text-sm text-fg">{renderNotification(m, n.type, n.refs)}</span>
              </>
            )
            const rowClass = 'flex items-start gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0'
            // #460: com alvo → MENUITEM navegável (asChild <Link>): o Radix registra p/ setas/Enter e
            // FECHA a caixa no select (mesmo padrão do AuthSlot). O detalhe já vem `/{locale}/recipes/…`
            // de `notificationHref`; o perfil é `/u/<handle>` (o proxy prefixa o locale). Sem alvo
            // (informativo/ator degradado) → linha estática, texto puro (não é ação, não é foco).
            return href ? (
              <DropdownMenuItem
                key={n.id}
                asChild
                className={`${rowClass} rounded-none focus:bg-brand/[0.06] data-[highlighted]:bg-brand/[0.06]`}
              >
                <Link href={href}>{inner}</Link>
              </DropdownMenuItem>
            ) : (
              <div key={n.id} className={rowClass}>
                {inner}
              </div>
            )
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
