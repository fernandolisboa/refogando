'use client'
/**
 * Aviso de mudança dos textos legais (ADR-0051), montado no layout `[locale]` no começo do conteúdo (o
 * skip-link não o pula). É o mecanismo do item 10 dos Termos: mudança relevante só vale 15 dias depois deste
 * aviso. Só para quem está logado e tem conta criada até o dia da publicação (`shouldShowLegalNotice`): quem se
 * cadastrou depois já viu os Termos na linha do cadastro. Visitante não vê nada.
 *
 * "Entendi" guarda a dispensa no localStorage, por versão e por conta (`avisoLegalStorageKey`); uma versão nova
 * (`AVISO_LEGAL_VERSAO`) traz o aviso de volta. Storage bloqueado: o aviso aparece e a dispensa vale até a
 * próxima carga. Era o padrão do aviso das restrições (`restricoes-perfil-form.tsx`) até o #600, que passou a usar a
 * versão gravada do consentimento; aqui segue o localStorage, para o app todo.
 *
 * Sem erro de hidratação: o servidor e o 1º render do cliente não mostram nada; a decisão (sessão + storage)
 * roda num timer depois da montagem, como o `AccountNotice` e o `GuidedTour`. Ao dispensar, o foco vai para o
 * título principal da página (o botão some e o foco cairia no `<body>`).
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { localePrefixedPath } from '@/i18n/locale-path'
import { useSession } from '@/lib/auth-client'
import { Container } from '@/components/container'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { avisoLegalStorageKey, shouldShowLegalNotice } from '@/domain/legal-notice'

/** `undefined` = storage ilegível (o aviso aparece). */
function avisoDispensado(userId: string): boolean | undefined {
  try {
    return window.localStorage.getItem(avisoLegalStorageKey(userId)) === '1'
  } catch {
    return undefined
  }
}

function marcarAvisoDispensado(userId: string): void {
  try {
    window.localStorage.setItem(avisoLegalStorageKey(userId), '1')
  } catch {
    // Storage bloqueado: o aviso some nesta carga (ref abaixo) e volta numa próxima visita.
  }
}

/** O `<h1>` da página (o único do documento); sem ele, o wrapper do conteúdo, alvo do skip-link. */
function focarTituloPrincipal(): void {
  const h1 = document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('h1')
  if (h1) {
    // tabindex -1: recebe foco programático sem virar tab stop.
    if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1')
    h1.focus()
    return
  }
  document.getElementById('conteudo')?.focus()
}

export function LegalChangeNotice() {
  const { locale, messages } = useLocale()
  const m = messages.avisoLegal
  const session = useSession()
  // Pela presença do usuário, não pelo `error`: numa re-busca que falha (fora o 401) o better-auth mantém os
  // dados da sessão, e o aviso não deve sumir e voltar por causa disso.
  const user = session.isPending ? null : session.data?.user
  const userId = user?.id ?? null
  // Em número: o `Date` da sessão muda de identidade a cada re-busca, e o efeito não precisa re-rodar por isso.
  const createdAtRaw = user?.createdAt
  const createdAtMs = createdAtRaw == null ? null : new Date(createdAtRaw).getTime()

  // Para quem o aviso está aberto (null = fechado). Guardar o id evita mostrar o aviso de uma conta para outra.
  const [abertoPara, setAbertoPara] = useState<string | null>(null)
  // Dispensas desta carga, para quando o storage está bloqueado.
  const dispensados = useRef(new Set<string>())

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (userId == null || dispensados.current.has(userId)) {
        setAbertoPara(null)
        return
      }
      const mostrar = shouldShowLegalNotice({
        authed: true,
        createdAt: createdAtMs,
        dismissed: avisoDispensado(userId),
      })
      setAbertoPara(mostrar ? userId : null)
    }, 0)
    return () => window.clearTimeout(t)
  }, [userId, createdAtMs])

  function dispensar() {
    if (abertoPara != null) {
      dispensados.current.add(abertoPara)
      marcarAvisoDispensado(abertoPara)
    }
    setAbertoPara(null)
    focarTituloPrincipal()
  }

  if (abertoPara == null || abertoPara !== userId) return null

  return (
    <Container className="pt-4">
      {/* `role="note"`: informa sem interromper o leitor de tela (padrão dos avisos do app). */}
      <Alert
        variant="info"
        role="note"
        className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between"
      >
        <AlertDescription className="text-foreground">
          {m.texto}{' '}
          <Link
            href={localePrefixedPath(locale, '/termos')}
            className="font-medium text-brand-ink hover:underline"
          >
            {messages.termos.nome}
          </Link>
          {' · '}
          <Link
            href={localePrefixedPath(locale, '/privacidade')}
            className="font-medium text-brand-ink hover:underline"
          >
            {messages.privacidade.titulo}
          </Link>
        </AlertDescription>
        <Button type="button" variant="outline" size="sm" onClick={dispensar}>
          {m.fechar}
        </Button>
      </Alert>
    </Container>
  )
}
