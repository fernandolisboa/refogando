'use client'
/**
 * Slot de estado de autenticação no header (issue #55). Ponto de verdade do estado de
 * sessão na chrome: lê `useSession` do cliente Better Auth (@/lib/auth-client), que fala
 * com o route handler `/api/auth/[...all]` via fetch (ADR-0010). Isolamento preservado
 * (#4.AC4): o slot só fala com /api/auth — NUNCA com endpoint de Receita nem o seam
 * logado.
 *
 * O slot em si gateia por PRESENÇA de sessão (menu vs "Entrar"); o ÚNICO uso de papel é a
 * afordância do item "Painel" dentro do menu (#125, fail-closed — LANDMINE #51), que o /admin
 * sempre revalida server-side. Não há decisão de ACESSO aqui, só de exibição.
 *
 * Estados tratados:
 * - carregando (isPending): espaçador puramente visual com dimensão concreta (sem CLS).
 *   É `aria-hidden` (sai da árvore de a11y) — não anuncia "carregando"; é só reserva de
 *   espaço pra a barra não pular. Sem `aria-busy` aqui: num nó aria-hidden ele seria morto;
 * - erro de leitura (error != null): fail-open → trata como anônimo (Visitante preserva
 *   acesso público de leitura; o gating de escrita real é server-side requireSession,
 *   não da chrome — nunca travar a chrome num erro de get-session);
 * - anônimo: Link "Entrar" → /sign-in;
 * - autenticado (#267): avatar + nome viram o GATILHO de um menu dropdown (Radix) com os atalhos
 *   da conta — Ver meu perfil público (`/u/<handle>`), Editar perfil (`/me/profile`), Painel
 *   (`/admin`, só curador+) e Sair (signOut + refetch). "Painel" e "Sair" deixaram a nav/cluster
 *   e passaram a morar AQUI; por isso o gating de papel (#125/#51, fail-closed) também vive aqui.
 */
import Link from 'next/link'
import { ChevronDownIcon } from 'lucide-react'
import { useLocale } from '@/i18n/provider'
import { useSession, signOut } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar } from '@/components/profile/avatar'
import { isRole } from '@/domain/user'
import { decideRole } from '@/domain/access'

export function AuthSlot() {
  const { messages } = useLocale()
  const { data: session, isPending, error, refetch } = useSession()

  // Carregando: reserva o espaço (altura ~igual ao btnPrimarySm, largura mínima cobrindo
  // "Entrar"/"Sair"/nome curto) pra a barra não pular quando a sessão resolver.
  if (isPending) {
    return <span aria-hidden="true" className="inline-flex h-8 min-w-[5rem] items-center" />
  }

  // Anônimo (sem sessão) OU erro de leitura (fail-open): afordância de "Entrar".
  // variant="secondary" (não primária): no header a única ação destacada é o pill "Criar"
  // (protótipo). "Entrar" é silenciosa.
  if (error || !session) {
    return (
      <Button asChild variant="secondary" size="sm">
        <Link href="/sign-in">{messages.nav.signIn}</Link>
      </Button>
    )
  }

  const nameOrEmail = session.user.name || session.user.email
  // Papel cru → Role|null (mesma normalização fail-closed do header/#51): papel null/desconhecido
  // NUNCA mostra "Painel". `decideRole` é a fonte única da afordância; o /admin revalida server-side.
  const rawRole = (session.user as { role?: string | null }).role
  const role = typeof rawRole === 'string' && isRole(rawRole) ? rawRole : null
  const showPainel = decideRole(role, 'curador') === 'allow'
  // `handle` vem da sessão por leitura de runtime NÃO-tipada (mesmo padrão do `role`): é um
  // additionalField do Better Auth (input:false) e coluna notNull — o servidor sempre o serializa,
  // mesmo o tipo do cliente não o conhecendo. Guard defensivo: o item "Ver meu perfil público" só
  // aparece com handle não-vazio (degradação graciosa — o link nunca aponta pra `/u/undefined`).
  const handle = (session.user as { handle?: string | null }).handle

  // signOut + refetch: numa falha de transporte do signOut (offline) o finally NÃO deixa promise
  // rejeitada não-tratada e ainda re-busca a sessão pra a chrome refletir o estado real do servidor.
  const doSignOut = async () => {
    try {
      await signOut()
    } finally {
      await refetch()
    }
  }

  return (
    // modal={false}: menu pequeno, não precisa scroll-lock; e evita empilhar pointer-lock quando
    // o gatilho mora dentro do drawer mobile (Radix Dialog). Esc/clique-fora/foco-de-volta seguem
    // do DismissableLayer. O conteúdo portaleia pro body de qualquer jeito (DropdownMenuContent).
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-md text-sm text-muted transition-colors hover:text-fg"
        title={nameOrEmail}
      >
        {/* O avatar é users.image (Vercel Blob ou Google OAuth); NULL cai nas iniciais. Aqui é
            DECORATIVO (alt=""): o nome visível ao lado já dá o rótulo acessível do gatilho — sem
            alt, o nome do botão não duplica ("Ana" e não "Foto de Ana Ana"). Sem `outline-none`:
            o anel de foco vem do `:focus-visible` global (foco volta pro gatilho ao fechar o menu). */}
        <Avatar src={session.user.image} name={nameOrEmail} alt="" size="sm" />
        <span className="max-w-[10rem] truncate">{nameOrEmail}</span>
        <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* "Ver meu perfil público" → /u/<handle> (sem prefixo de locale: o proxy prefixa). Só
            renderiza com handle presente. asChild deixa o <a> herdar role=menuitem. */}
        {handle && (
          <DropdownMenuItem asChild>
            <Link href={`/u/${handle}`}>{messages.nav.verPerfilPublico}</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href="/me/profile">{messages.nav.editarPerfil}</Link>
        </DropdownMenuItem>
        {/* "Painel" (#125) só a curador+ — afordância; o /admin revalida o papel server-side. */}
        {showPainel && (
          <DropdownMenuItem asChild>
            <Link href="/admin">{messages.nav.painel}</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {/* "Sair": item de AÇÃO (não link). `void` no onSelect — Radix fecha o menu e o signOut
            roda async depois; não retornar a promise pro onSelect. */}
        <DropdownMenuItem onSelect={() => void doSignOut()}>{messages.nav.signOut}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
