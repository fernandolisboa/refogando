'use client'
/**
 * "Criar minha versão" (#17 UI / #61) — DERIVA uma Receita NÃO-própria (catálogo OU pública de
 * outra pessoa). Editar uma receita que NÃO é sua NUNCA muta a base: cria uma CÓPIA sua
 * (derivada) com diff congelado. Prefilled a partir da `RecipeView` base; mostra o aviso de que
 * isto cria uma cópia; POSTa `POST /api/recipes/[id]/derive` e NAVEGA para a nova derivada.
 *
 * ADR-0010: consome o ROUTE HANDLER via `fetch`; o servidor é a verdade (reimpõe que derivar a
 * própria é 409, privada de outro 404). Contrato: 201 `{ recipeId }` → navega; 400/404/409 →
 * mensagem neutra. Tokens NEUTROS (âmbar é exclusivo do Aviso de restrição, ADR-0004).
 *
 * O fluxo abre fechado (um botão "Criar minha versão"); ao expandir, mostra o aviso de cópia +
 * o formulário. `<h2>` (o detalhe já emite o `<h1>`).
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { fieldClassName } from '@/components/button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { RESTRICOES, UNIDADES } from '@/domain/vocabulary'
import type { RecipeView } from '@/domain/recipe-read'

type ItemDraft = { rawText: string; quantidade: string; unidade: string }

function itemsFromView(view: RecipeView): ItemDraft[] {
  const items = [...view.ingredients]
    .sort((a, b) => a.ordem - b.ordem)
    .map((it) => ({
      rawText: it.rawText ?? '',
      quantidade: it.quantidade ?? '',
      unidade: it.unidade ?? '',
    }))
  return items.length > 0 ? items : [{ rawText: '', quantidade: '', unidade: '' }]
}

export function DeriveExperience({ view, locale }: { view: RecipeView; locale: string }) {
  const { messages } = useLocale()
  const m = messages.derivada
  const mc = messages.criar
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [titulo, setTitulo] = useState(view.name)
  const [descricao, setDescricao] = useState(view.body.descricao ?? '')
  const [passos, setPassos] = useState((view.body.passos ?? []).join('\n'))
  const [notas, setNotas] = useState(view.body.notas ?? '')
  const [restricoes, setRestricoes] = useState<string[]>([...(view.facets.restricoes ?? [])])
  const [itens, setItens] = useState<ItemDraft[]>(itemsFromView(view))

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function patchItem(index: number, patch: Partial<ItemDraft>) {
    setItens((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }
  function addItem() {
    setItens((prev) => [...prev, { rawText: '', quantidade: '', unidade: '' }])
  }
  function removeItem(index: number) {
    setItens((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
  }
  function toggleRestricao(value: string) {
    setRestricoes((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )
  }

  function buildEdits() {
    const passosArr = passos
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
    const ingredientes = itens
      .filter((it) => it.rawText.trim() !== '' || it.quantidade.trim() !== '' || it.unidade !== '')
      .map((it) => ({
        rawText: it.rawText.trim() === '' ? null : it.rawText.trim(),
        quantidade: it.quantidade.trim() === '' ? null : it.quantidade.trim(),
        unidade: it.unidade === '' ? null : it.unidade,
      }))
    return {
      titulo: titulo.trim(),
      descricao: descricao.trim() === '' ? null : descricao,
      passos: passosArr.length > 0 ? passosArr : null,
      notas: notas.trim() === '' ? null : notas,
      restricoes,
      ingredientes,
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (saving) return
    setError(null)
    if (titulo.trim().length === 0) {
      setError(mc.erroCampos)
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/recipes/${view.id}/derive?locale=${encodeURIComponent(locale)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ edits: buildEdits() }),
      })
      if (res.status === 201) {
        const data = (await res.json()) as { recipeId: string; imageReviewSuggested?: boolean }
        // #131: mudança visual com imagem herdada ⇒ leva a dica de revisar a foto pra a derivada.
        const q = data.imageReviewSuggested ? '?reviewImage=1' : ''
        router.push(`/recipes/${data.recipeId}${q}`)
        router.refresh()
        return
      }
      // 409 derivar_da_propria não deveria ocorrer (este componente só aparece em não-própria),
      // mas qualquer não-201 cai numa mensagem neutra.
      setError(mc.erroGeracao)
    } catch {
      setError(mc.erroConexao)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <div>
        <Button type="button" onClick={() => setOpen(true)}>
          {messages.minhasCriacoes.criarMinhaVersao}
        </Button>
      </div>
    )
  }

  return (
    <section
      aria-labelledby="derivar-titulo"
      className="flex flex-col gap-5 rounded-md border border-border bg-surface px-4 py-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="derivar-titulo" className="font-display text-lg font-semibold text-fg">
          {m.copiaTitulo}
        </h2>
        {/* Aviso de CÓPIA — neutro (NÃO âmbar). */}
        <p className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg">
          {m.copiaAviso}
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
          {messages.criar.titulo}
          <Input
            type="text"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
          {messages.detalhe.descricao}
          <Textarea
            rows={2}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="resize-y"
          />
        </label>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium text-fg">{mc.legendaIngredientes}</legend>
          <ul role="list" className="flex flex-col gap-3">
            {itens.map((item, index) => (
              <li
                key={index}
                className="flex flex-col gap-2 rounded-md border border-border bg-bg p-3 sm:flex-row sm:items-end"
              >
                <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium text-fg">
                  {`${mc.ingrediente} ${index + 1}`}
                  <Input
                    type="text"
                    value={item.rawText}
                    onChange={(e) => patchItem(index, { rawText: e.target.value })}
                  />
                </label>
                <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:w-24">
                  {mc.quantidade}
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={item.quantidade}
                    onChange={(e) => patchItem(index, { quantidade: e.target.value })}
                  />
                </label>
                <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-fg sm:w-36">
                  {mc.unidade}
                  <select
                    value={item.unidade}
                    onChange={(e) => patchItem(index, { unidade: e.target.value })}
                    className={fieldClassName}
                  >
                    <option value="">{mc.unidadeNenhuma}</option>
                    {UNIDADES.map((u) => (
                      <option key={u} value={u}>
                        {messages.unidadeLabel[u]}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => removeItem(index)}
                  disabled={itens.length <= 1}
                  aria-label={`${mc.removerIngrediente} ${index + 1}`}
                  className="disabled:cursor-not-allowed disabled:border disabled:border-border disabled:opacity-50"
                >
                  {mc.removerIngrediente}
                </Button>
              </li>
            ))}
          </ul>
          <div>
            <Button type="button" variant="secondary" onClick={addItem}>
              {mc.adicionarIngrediente}
            </Button>
          </div>
        </fieldset>

        <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
          {messages.detalhe.passos}
          <Textarea
            rows={4}
            value={passos}
            onChange={(e) => setPassos(e.target.value)}
            className="resize-y"
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-fg">{mc.legendaRestricoes}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {RESTRICOES.map((r) => (
              <label key={r} className="inline-flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={restricoes.includes(r)}
                  onChange={() => toggleRestricao(r)}
                  className="accent-brand-strong"
                />
                {messages.restricaoLabel[r]}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
          {messages.detalhe.notas}
          <Textarea
            rows={2}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            className="resize-y"
          />
        </label>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
          >
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={saving}
            aria-busy={saving}
            className="disabled:cursor-not-allowed disabled:border disabled:border-border disabled:opacity-70"
          >
            {saving ? messages.system.loading : messages.minhasCriacoes.criarMinhaVersao}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {messages.edicaoPropria.editarPublicaCancelar}
          </Button>
        </div>
      </form>
    </section>
  )
}
