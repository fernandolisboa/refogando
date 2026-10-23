'use client'
/**
 * Faixa da home para quem não entrou na conta (#472): uma frase curta + botão para o cadastro, acima da
 * "Receita da semana". Montada pela home (server) dentro do `highlight`, então só aparece no REPOUSO.
 *
 * Vem no HTML do servidor para todo mundo: a home de repouso é anônima e cacheável (não lê cookie), então o
 * servidor não sabe quem está logado. Pintar a faixa só depois que o navegador confirmasse o visitante
 * empurraria a receita da semana e o feed para baixo em todo carregamento (salto de layout, CLS, justamente para
 * o público da home indexável). Assim o visitante e o crawler a veem desde o primeiro quadro, e ela some quando a
 * sessão mostra uma conta. Na navegação dentro do app a sessão já está carregada e a faixa nem chega a pintar.
 *
 * A frase (`indice`) é sorteada pela home no servidor, uma vez por requisição (`sortearFaixa`), e desce por prop:
 * servidor e hidratação pintam a mesma. Sem guardar a última no navegador: seria mais um item no armazenamento
 * local que a Política lista um a um (item 8), por um ganho pequeno.
 */
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { localePrefixedPath } from '@/i18n/locale-path'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'

export function HomeValueBanner({ indice }: { indice: number }) {
  const { locale, messages } = useLocale()
  const session = useSession()
  const m = messages.faixaHome

  // Só uma conta confirmada esconde. Pendente (SSR, hidratação, refetch) ou erro na leitura da sessão: mostra,
  // como o resto da home trata quem não se sabe se entrou.
  if (session.data) return null

  return (
    <section
      aria-labelledby="faixa-home-titulo"
      className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id="faixa-home-titulo" className="font-display text-2xl font-semibold tracking-tight text-fg">
          {m.titulos[indice]}
        </h2>
        <p className="text-muted">{m.textos[indice]}</p>
      </div>
      <Button asChild className="shrink-0 self-start sm:self-auto">
        <Link href={localePrefixedPath(locale, '/sign-up')}>{m.botoes[indice]}</Link>
      </Button>
    </section>
  )
}
