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
 *
 * Cada item mostra QUANDO aconteceu: "agora", "há 3 horas", "há 2 dias" até uma semana; daí para trás, a data
 * (`formatRelativeTime`). O instante completo fica no `title` do `<time>`. O relógio é lido ao ABRIR o painel
 * (o conteúdo só monta aberto), nunca no render: sem divergência de SSR e sem `Date.now()` impuro no corpo.
 *
 * #609: nas retiradas pela curadoria, o texto já traz a categoria do motivo (`renderNotification`) e, ABAIXO do item,
 * vem um segundo menuitem "Pedir nova análise" (`mailto:` do canal de privacidade, `notificationAppealHref`). É irmão
 * do link do item, nunca aninhado (link dentro de link é HTML inválido e confunde o leitor de tela).
 */
import { useState } from 'react'
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
import { renderNotification, notificationHref, notificationAppealHref } from '@/domain/notification'
import { formatDateTime, formatRelativeTime } from '@/domain/relative-time'
import { useNotifications } from '@/components/use-notifications'

export function NotificationBell() {
  const { locale, messages } = useLocale()
  const session = useSession()
  const authed = !session.isPending && !session.error && !!session.data
  const { notifications, unreadCount, markAllRead } = useNotifications()
  // "Agora" de referência dos tempos relativos: atualizado a cada abertura do painel.
  const [now, setNow] = useState(() => Date.now())

  // Modelo B: nada no SSR / anon / pendente (a chrome anon fica byte-idêntica). Os hooks acima rodam
  // sempre (ordem estável); só o RENDER é gateado.
  if (!authed) return null

  const m = messages.notifications
  const badge = unreadCount > 99 ? '99+' : String(unreadCount)
  // #461 (a11y): o rótulo do sino ANUNCIA a contagem de não-lidas (o badge é `aria-hidden` — visual).
  // 0 → só "Notificações"; 1 → singular; >1 → plural com `{n}` (número real, não o "99+" visual).
  const bellLabel =
    unreadCount === 0
      ? m.ariaLabel
      : unreadCount === 1
        ? m.ariaLabelUmaNaoLida
        : m.ariaLabelNaoLidas.replace('{n}', String(unreadCount))

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (!open) return
        setNow(Date.now())
        markAllRead()
      }}
    >
      <DropdownMenuTrigger
        aria-label={bellLabel}
        className="relative inline-flex size-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-brand/10 hover:text-fg"
      >
        <BellIcon aria-hidden="true" className="size-5" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-brand-strong px-1 text-[0.625rem] leading-4 font-semibold text-white"
          >
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
            const text = renderNotification(m, n.type, n.refs)
            // #609: retirada pela curadoria → link IRMÃO "Pedir nova análise" (mailto do canal de privacidade).
            const appealHref = notificationAppealHref(m, n.type, n.refs)
            const quando = formatRelativeTime(n.createdAt, now, locale)
            const inner = (
              <>
                <Avatar src={n.actorImage} name={n.refs.actorName ?? ''} alt="" size="sm" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm text-fg">{text}</span>
                  {/* Espaço p/ o nome acessível ("… seguir você há 3 horas"); num flex não aparece. */}
                  {quando && ' '}
                  {quando && (
                    <time dateTime={n.createdAt} title={formatDateTime(n.createdAt, locale)} className="text-xs text-muted">
                      {quando}
                    </time>
                  )}
                </span>
              </>
            )
            const rowClass = 'flex items-start gap-3 px-3 py-2.5'
            const itemClass = 'rounded-none focus:bg-brand/[0.06] data-[highlighted]:bg-brand/[0.06]'
            // #460: com alvo → MENUITEM navegável (asChild <Link>): o Radix registra p/ setas/Enter e
            // FECHA a caixa no select (mesmo padrão do AuthSlot). O detalhe já vem `/{locale}/recipes/…`
            // de `notificationHref`; o perfil é `/u/<handle>` (o proxy prefixa o locale). Sem alvo
            // (informativo/ator degradado) → linha estática, texto puro (não é ação, não é foco).
            const main = href ? (
              <DropdownMenuItem asChild className={`${rowClass} ${itemClass}`}>
                <Link href={href}>{inner}</Link>
              </DropdownMenuItem>
            ) : (
              <div className={rowClass}>{inner}</div>
            )
            // #609: o link de nova análise é OUTRO menuitem, ao lado do item (nunca um link dentro do link):
            // setas/Enter iguais aos demais itens. O nome acessível repete a frase, para distinguir vários.
            return (
              <div key={n.id} className="border-b border-border/60 last:border-b-0">
                {main}
                {appealHref && (
                  <DropdownMenuItem
                    asChild
                    className={`${itemClass} -mt-1 pt-0 pb-2.5 pr-3 pl-14 text-xs font-medium text-fg underline underline-offset-2`}
                  >
                    <a href={appealHref} aria-label={m.pedirNovaAnaliseAria.replace('{texto}', text)}>
                      {m.pedirNovaAnalise}
                    </a>
                  </DropdownMenuItem>
                )}
              </div>
            )
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
