'use client'
/**
 * Página "Como usar" (/guia, ADR-0039): o guia de uso do app, em texto, para quem prefere ler, e o
 * ponto de partida para refazer o tour guiado. Client component (como a Política de Privacidade) para
 * acompanhar a troca de idioma em runtime; todo o texto vem de `messages.guia`. Pública: o Visitante
 * lê o guia inteiro e também pode fazer o tour (a versão sem os passos só-logados).
 */
import { useRouter } from 'next/navigation'
import { MapIcon } from 'lucide-react'
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'
import { Button } from '@/components/ui/button'
import { requestTourStart } from '@/components/onboarding/tour-signal'
import type { Messages } from '@/i18n/messages'

type Guia = Messages['guia']

/** Seções na ordem da página; `id` vira a âncora do índice. */
const SECTIONS: ReadonlyArray<{ id: string; title: (g: Guia) => string; items: (g: Guia) => readonly string[] }> = [
  { id: 'buscar', title: (g) => g.buscarTitulo, items: (g) => g.buscarItens },
  { id: 'criar', title: (g) => g.criarTitulo, items: (g) => g.criarItens },
  { id: 'receita', title: (g) => g.receitaTitulo, items: (g) => g.receitaItens },
  { id: 'salvos', title: (g) => g.salvosTitulo, items: (g) => g.salvosItens },
  { id: 'lista-de-compras', title: (g) => g.listaTitulo, items: (g) => g.listaItens },
  { id: 'cardapio', title: (g) => g.cardapioTitulo, items: (g) => g.cardapioItens },
  { id: 'comunidade', title: (g) => g.comunidadeTitulo, items: (g) => g.comunidadeItens },
  { id: 'conta', title: (g) => g.contaTitulo, items: (g) => g.contaItens },
]

export function UsageGuide() {
  const { messages } = useLocale()
  const g = messages.guia
  const router = useRouter()

  const startTour = () => {
    // O tour vive na home (os alvos estão lá): deixa o pedido e navega; o GuidedTour abre ao chegar.
    requestTourStart()
    router.push('/')
  }

  return (
    <Container as="main" size="reading" className="py-10">
      <h1 className="font-display text-3xl font-semibold text-brand-ink">{g.titulo}</h1>
      <p className="mt-3 leading-relaxed text-fg">{g.intro}</p>

      <section
        aria-labelledby="guia-tour"
        className="mt-6 flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <h2 id="guia-tour" className="font-semibold text-fg">
            {g.tourTitulo}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{g.tourTexto}</p>
        </div>
        <Button onClick={startTour} className="shrink-0">
          <MapIcon aria-hidden="true" />
          {g.tourBotao}
        </Button>
      </section>

      <nav aria-labelledby="guia-indice" className="mt-8">
        <h2 id="guia-indice" className="text-sm font-medium text-muted">
          {g.indice}
        </h2>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-brand-ink underline-offset-4 hover:underline">
                {s.title(g)}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-titulo`} className="mt-10 scroll-mt-24">
          <h2
            id={`${s.id}-titulo`}
            className="border-b border-border pb-2 font-display text-2xl font-semibold text-brand-ink"
          >
            {s.title(g)}
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed text-fg">
            {s.items(g).map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </Container>
  )
}
