'use client'
/**
 * Controle do DONO DA BASE numa Receita derivada (#610, ADR-0052): "Retirar meu nome" do "Baseada na receita … de
 * @você" desta cópia, ou "Mostrar meu nome de novo" se ele já o retirou. Só monta quando a view buscada pela
 * sessão traz `creditoDoAutor` (o servidor decide quem é o dono da base; o cliente nunca deduz pelo @).
 *
 * `PUT /api/recipes/[id]/credit { exibir }`. A linha de crédito do topo é da árvore pública (renderizada no
 * servidor), então só muda no próximo carregamento; aqui o texto confirma o novo estado. Controlado: `exibir` vem
 * da área de gestão, que o atualiza a cada busca da view e no `onChange`. Erro (rede, 5xx, 404 se a cópia saiu do
 * ar ou o crédito deixou de valer) ⇒ mensagem neutra e o estado anterior; dá para tentar de novo. ADR-0010: route handler via
 * fetch, nunca Server Action.
 */
import { useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'

export function DerivedCreditAuthorControl({
  recipeId,
  exibir,
  onChange,
}: {
  recipeId: string
  exibir: boolean
  onChange: (exibir: boolean) => void
}) {
  const { messages } = useLocale()
  const m = messages.creditoCopias
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState(false)

  async function alternar() {
    if (salvando) return
    setSalvando(true)
    setErro(false)
    try {
      const res = await fetch(`/api/recipes/${recipeId}/credit`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ exibir: !exibir }),
      })
      if (!res.ok) {
        setErro(true)
        return
      }
      const body = (await res.json()) as { exibir?: unknown }
      if (typeof body.exibir === 'boolean') onChange(body.exibir)
      else setErro(true)
    } catch {
      setErro(true)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 text-sm">
      {/* Região viva: o novo estado é anunciado quando muda (o botão continua no mesmo lugar). */}
      <p aria-live="polite" className="text-muted">
        {exibir ? m.seuNome : m.retirado}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={alternar} disabled={salvando}>
        {salvando ? m.salvando : exibir ? m.retirar : m.mostrarDeNovo}
      </Button>
      {erro && (
        <p role="alert" className="font-medium text-fg">
          {m.erro}
        </p>
      )}
    </div>
  )
}
