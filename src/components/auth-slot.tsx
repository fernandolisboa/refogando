'use client'
/**
 * Slot de estado de autenticação no header (issue #55). Ponto de verdade do estado de
 * sessão na chrome: lê `useSession` do cliente Better Auth (@/lib/auth-client), que fala
 * com o route handler `/api/auth/[...all]` via fetch (ADR-0010). Isolamento preservado
 * (#4.AC4): o slot só fala com /api/auth — NUNCA com endpoint de Receita nem o seam
 * logado.
 *
 * Gateia por PRESENÇA de sessão, nunca por papel (papéis = #63 — LANDMINE #51).
 *
 * Estados tratados:
 * - carregando (isPending): espaçador puramente visual com dimensão concreta (sem CLS).
 *   É `aria-hidden` (sai da árvore de a11y) — não anuncia "carregando"; é só reserva de
 *   espaço pra a barra não pular. Sem `aria-busy` aqui: num nó aria-hidden ele seria morto;
 * - erro de leitura (error != null): fail-open → trata como anônimo (Visitante preserva
 *   acesso público de leitura; o gating de escrita real é server-side requireSession,
 *   não da chrome — nunca travar a chrome num erro de get-session);
 * - anônimo: Link "Entrar" → /sign-in;
 * - autenticado: nome (ou email) + botão "Sair" (signOut + refetch p/ a chrome refletir).
 */
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { useSession, signOut } from '@/lib/auth-client'
import { btnPrimarySm } from '@/components/button'
import { Avatar } from '@/components/profile/avatar'

export function AuthSlot() {
  const { messages } = useLocale()
  const { data: session, isPending, error, refetch } = useSession()

  // Carregando: reserva o espaço (altura ~igual ao btnPrimarySm, largura mínima cobrindo
  // "Entrar"/"Sair"/nome curto) pra a barra não pular quando a sessão resolver.
  if (isPending) {
    return <span aria-hidden="true" className="inline-flex h-8 min-w-[5rem] items-center" />
  }

  // Anônimo (sem sessão) OU erro de leitura (fail-open): afordância de "Entrar".
  if (error || !session) {
    return (
      <Link href="/sign-in" className={btnPrimarySm}>
        {messages.nav.signIn}
      </Link>
    )
  }

  const nameOrEmail = session.user.name || session.user.email
  return (
    <div className="flex items-center gap-3">
      {/* Avatar + nome levam ao perfil (#124/#126): clicar abre /me/profile pra editar. O avatar
          é users.image (Vercel Blob ou Google OAuth); NULL cai nas iniciais (sem dependência). */}
      <Link
        href="/me/profile"
        className="flex items-center gap-2 transition-colors hover:text-fg"
        title={nameOrEmail}
      >
        <Avatar
          src={session.user.image}
          name={nameOrEmail}
          alt={messages.perfil.avatarAlt.replace('{name}', nameOrEmail)}
          size="sm"
        />
        <span className="max-w-[10rem] truncate text-sm text-muted">{nameOrEmail}</span>
      </Link>
      <button
        type="button"
        className={btnPrimarySm}
        onClick={async () => {
          // try/finally: numa falha de transporte do signOut (offline) NÃO deixa promise
          // rejeitada não-tratada no handler async e ainda re-busca a sessão pra a chrome
          // refletir o estado real do servidor (consistente com o try/catch do auth-form).
          try {
            await signOut()
          } finally {
            await refetch()
          }
        }}
      >
        {messages.nav.signOut}
      </button>
    </div>
  )
}
