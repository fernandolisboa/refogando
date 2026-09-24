'use client'

/**
 * Traduções para re-revisão do Curador — defasadas-E-divergentes (#500, ADR-0031 dec.6).
 *
 * "Outro lado da moeda" da re-tradução automática (fatia B, #499): aqui a FONTE mudou e o
 * CONTEÚDO da linha já diverge da última MT (edição humana) — ou é legado sem prova de
 * intocabilidade (`mt_fingerprint IS NULL`) — então a re-tradução automática NUNCA a toca.
 * Consome `GET /api/curate/translations/divergent-stale` (comparação de hash no APP, sem
 * escrita) e leva o Curador à MESMA rota de edição já usada por `StaleTranslations` (#498):
 * `PATCH /api/recipes/[id]/translations/[locale]` (edição de nome de ingrediente traduzido) —
 * a correção manual concreta disponível hoje para tradução de comunidade.
 *
 * Componente SEPARADO de `StaleTranslations` por design (COMPÕE, não conflita): esta lista não
 * tem ação "marcar revisada" (proveniência não é a trava aqui — o fingerprint é, ADR-0031 dec.2)
 * — só o editor de nomes, idêntico em comportamento ao de #498.
 *
 * Cada item mostra o MOTIVO (#520): `divergente` (edição humana/legado) ou `falha_traducao` (o
 * tradutor falhou repetidamente nesta linha e o worker a pôs em quarentena — precisa de mão humana).
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  TRANSLATION_PROVENANCES,
  type TranslationProvenance,
} from '@/domain/recipe'

type DivergentItem = {
  recipeId: string
  locale: string
  provenance: string
  /** Por que está na lista: conteúdo editado à mão, ou quarentena do circuit-breaker da re-tradução (#520). */
  reason: 'divergente' | 'falha_traducao'
}

/** Ingrediente COM nome (rawText presente/não-vazio) — só estes são editáveis (espelha #498). */
type NamedIngredient = { ordem: number; rawText: string }

export function DivergentStaleTranslations() {
  const { messages } = useLocale()
  const m = messages.traducoesDivergentes
  const staleMessages = messages.traducoesStale
  const sys = messages.system

  const [items, setItems] = useState<DivergentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  // Editor de nomes de ingrediente (espelha StaleTranslations/#498) — no máximo UM expandido.
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [ingLoading, setIngLoading] = useState(false)
  const [ingLoadError, setIngLoadError] = useState(false)
  const [ingredients, setIngredients] = useState<NamedIngredient[]>([])
  const [names, setNames] = useState<Record<number, string>>({})
  const [ingSaving, setIngSaving] = useState(false)
  const [ingSaveError, setIngSaveError] = useState(false)
  const [ingSaveSuccess, setIngSaveSuccess] = useState(false)

  const provenanceLabel = {
    escrita_por_pessoa: staleMessages.provEscritaPorPessoa,
    automatica_revisada: staleMessages.provAutomaticaRevisada,
    automatica_nao_revisada: staleMessages.provAutomaticaNaoRevisada,
  } satisfies Record<TranslationProvenance, string>

  function labelProvenance(value: string): string {
    return (TRANSLATION_PROVENANCES as readonly string[]).includes(value)
      ? provenanceLabel[value as TranslationProvenance]
      : value
  }

  const itemKey = (it: DivergentItem) => `${it.recipeId}:${it.locale}`

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/curate/translations/divergent-stale')
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const bodyJson = (await res.json()) as { divergentStale: DivergentItem[] }
      setItems(bodyJson.divergentStale)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Timer (não no corpo síncrono do effect) — mesmo padrão de StaleTranslations/search-experience.
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [])

  function resetIngredientEditor() {
    setIngLoading(false)
    setIngLoadError(false)
    setIngredients([])
    setNames({})
    setIngSaving(false)
    setIngSaveError(false)
    setIngSaveSuccess(false)
  }

  async function toggleEditIngredients(item: DivergentItem) {
    const key = itemKey(item)
    if (expandedKey === key) {
      setExpandedKey(null)
      resetIngredientEditor()
      return
    }
    setExpandedKey(key)
    resetIngredientEditor()
    setIngLoading(true)
    try {
      const res = await fetch(
        `/api/recipes/${item.recipeId}?locale=${encodeURIComponent(item.locale)}`,
      )
      if (!res.ok) {
        setIngLoadError(true)
        return
      }
      const bodyJson = (await res.json()) as {
        ingredients: { ordem: number; rawText: string | null }[]
      }
      const named = bodyJson.ingredients.filter(
        (i): i is NamedIngredient => i.rawText != null && i.rawText.trim() !== '',
      )
      setIngredients(named)
      setNames(Object.fromEntries(named.map((i) => [i.ordem, i.rawText])))
    } catch {
      setIngLoadError(true)
    } finally {
      setIngLoading(false)
    }
  }

  async function saveIngredientNames(item: DivergentItem) {
    if (ingSaving) return
    // Dirty-diff: só os `ordem` cujo valor mudou (trim) contra o carregado.
    const edits = ingredients
      .map((i) => ({ ordem: i.ordem, nome: (names[i.ordem] ?? i.rawText).trim() }))
      .filter((e) => e.nome.length > 0 && e.nome !== ingredients.find((i) => i.ordem === e.ordem)?.rawText)
    setIngSaveError(false)
    setIngSaveSuccess(false)
    if (edits.length === 0) {
      setIngSaveSuccess(true)
      return
    }
    setIngSaving(true)
    try {
      const res = await fetch(`/api/recipes/${item.recipeId}/translations/${item.locale}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ edits }),
      })
      if (!res.ok) {
        setIngSaveError(true)
        return
      }
      setIngredients((prev) =>
        prev.map((i) => {
          const edited = edits.find((e) => e.ordem === i.ordem)
          return edited ? { ordem: i.ordem, rawText: edited.nome } : i
        }),
      )
      setIngSaveSuccess(true)
    } catch {
      setIngSaveError(true)
    } finally {
      setIngSaving(false)
    }
  }

  return (
    <section aria-labelledby="divergent-stale-titulo" className="flex flex-col gap-3">
      <div>
        <h2 id="divergent-stale-titulo" className="font-display text-lg font-semibold text-fg">
          {m.titulo}
        </h2>
        <p className="text-sm text-muted">{m.descricao}</p>
      </div>

      <div aria-live="polite" aria-busy={loading} className="flex flex-col gap-3">
        {loading ? (
          <p className="text-sm text-muted">{sys.loading}</p>
        ) : loadError ? (
          <div className="flex flex-col items-start gap-2">
            <p
              role="alert"
              className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
            >
              {sys.error}
            </p>
            <Button type="button" size="sm" onClick={() => void load()}>
              {sys.retry}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">{m.listaVazia}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => {
              const key = itemKey(item)
              const expanded = expandedKey === key
              return (
                <li
                  key={key}
                  className="flex flex-col gap-2 rounded-md border border-border bg-surface px-4 py-3"
                >
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                    <dt className="font-medium text-fg">{m.receita}</dt>
                    <dd className="truncate text-muted" title={item.recipeId}>
                      {item.recipeId}
                    </dd>
                    <dt className="font-medium text-fg">{m.idioma}</dt>
                    <dd className="text-muted">{item.locale}</dd>
                    <dt className="font-medium text-fg">{m.origem}</dt>
                    <dd className="text-muted">{labelProvenance(item.provenance)}</dd>
                    <dt className="font-medium text-fg">{m.motivo}</dt>
                    <dd className="text-muted">
                      {item.reason === 'falha_traducao' ? m.motivoFalhaTraducao : m.motivoDivergente}
                    </dd>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void toggleEditIngredients(item)}
                      aria-expanded={expanded}
                    >
                      {expanded ? staleMessages.fecharNomes : staleMessages.editarNomes}
                    </Button>
                  </div>
                  {expanded && (
                    <div
                      aria-live="polite"
                      aria-busy={ingLoading}
                      className="flex flex-col gap-2 rounded-md border border-border bg-bg p-3"
                    >
                      {ingLoading ? (
                        <p className="text-sm text-muted">{staleMessages.carregandoIngredientes}</p>
                      ) : ingLoadError ? (
                        <p role="alert" className="text-sm font-medium text-fg">
                          {staleMessages.erroCarregarIngredientes}
                        </p>
                      ) : ingredients.length === 0 ? (
                        <p className="text-sm text-muted">{staleMessages.semIngredientesNomeados}</p>
                      ) : (
                        <>
                          <ul className="flex flex-col gap-2">
                            {ingredients.map((ing) => (
                              <li key={ing.ordem} className="flex flex-col gap-1">
                                <label
                                  htmlFor={`div-ing-nome-${key}-${ing.ordem}`}
                                  className="text-xs font-medium text-muted"
                                >
                                  {staleMessages.nomeIngredienteLabel}
                                </label>
                                <Input
                                  id={`div-ing-nome-${key}-${ing.ordem}`}
                                  value={names[ing.ordem] ?? ''}
                                  onChange={(e) =>
                                    setNames((prev) => ({ ...prev, [ing.ordem]: e.target.value }))
                                  }
                                  disabled={ingSaving}
                                />
                              </li>
                            ))}
                          </ul>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void saveIngredientNames(item)}
                              disabled={ingSaving}
                              aria-busy={ingSaving}
                            >
                              {ingSaving ? staleMessages.salvando : staleMessages.salvarNomes}
                            </Button>
                            {ingSaveSuccess && (
                              <p className="text-sm text-muted">{staleMessages.nomesSalvos}</p>
                            )}
                          </div>
                          {ingSaveError && (
                            <p role="alert" className="text-sm font-medium text-fg">
                              {staleMessages.erroSalvarNomes}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
