'use client'
/**
 * Faixa da home para quem não entrou na conta (#472): uma frase curta + botão para o cadastro, acima da
 * "Receita da semana". Montada pela home (server) dentro do `highlight`, então só aparece no REPOUSO.
 *
 * Só no navegador, de propósito: a home de repouso é anônima e cacheável (não lê cookie), então o servidor
 * não sabe quem está logado. Enquanto a sessão está pendente (SSR e hidratação, ver `useSession`) a faixa
 * não pinta nada; logado também não. Assim quem está logado nunca vê a faixa piscar e o HTML do crawler
 * fica igual ao de antes.
 *
 * A frase é sorteada uma vez por montagem (cada carregamento da home), entre as listas de `faixaHome` por
 * índice. Sem guardar a última no navegador: isso seria mais um item no armazenamento local que a Política
 * lista um a um (item 8), por um ganho pequeno.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { localePrefixedPath } from '@/i18n/locale-path'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'

/** Índice sorteado em [0, total). `random` injetável para teste; fora da faixa cai no último. */
export function sortearFaixa(total: number, random: () => number = Math.random): number {
  return Math.min(total - 1, Math.max(0, Math.floor(random() * total)))
}

export function HomeValueBanner() {
  const { locale, messages } = useLocale()
  const session = useSession()
  const m = messages.faixaHome
  // Sorteio no inicializador: roda no 1º render (inclusive o de hidratação), quando a faixa ainda não
  // pinta, e fica fixo depois. A troca de idioma em runtime mantém a mesma frase, traduzida.
  const [indice] = useState(() => sortearFaixa(m.titulos.length))

  if (session.isPending || session.data) return null

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
