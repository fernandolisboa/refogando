'use client'

/**
 * Traduções desatualizadas (#63, AC2) — Curador+ (o servidor reforça requireRole 'curador').
 *
 * ADR-0010: consome `GET /api/curate/translations/stale` + `POST /api/recipes/[id]/
 * translations/[locale]/review` via `fetch` (NÃO Server Action). Sinalização LEVE, sem
 * bloqueio (CONTEXT.md): só Comunidade aparece (a rota já filtra). Marcar revisada é otimista
 * (remove o item) e REVERTE no erro. SEM `router.refresh()`: o estado local é autoritativo.
 *
 * Rótulo de VALOR localizado para `provenance` via lookup `satisfies Record<...>`. A chave de
 * busy é `${recipeId}:${locale}` (a tupla é a identidade, não o recipeId só). Cores: só
 * neutros/brand AA-verificados; sem âmbar/accent.
 *
 * Edição de NOME de ingrediente traduzido (#498, ADR-0031 companheiro iii): cada item ganha um
 * expansor "editar nomes" que carrega a lista de ingredientes via `GET /api/recipes/[id]?locale=`
 * (leitura PÚBLICA já community-gated — a MESMA receita já passou pelo filtro da fila stale, então
 * o fetch nunca 404) e grava via `PATCH /api/recipes/[id]/translations/[locale]` (novo, mesmo gate
 * de comunidade/moderação do POST/review acima, `requireRole('curador')`). SÓ envia `edits` dos
 * campos REALMENTE alterados (dirty-diff contra o valor carregado) — evita PATCH vazio/no-op. Só
 * ingredientes COM nome (`rawText` presente/não-vazio) são editáveis — item sem nome não tem o que
 * editar aqui. Só UM item expandido por vez (mesmo padrão de `busyKey`); expandir outro fecha o
 * anterior e descarta edições não salvas do anterior (sem confirmação — sinalização leve, CONTEXT.md).
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  TRANSLATION_PROVENANCES,
  type TranslationProvenance,
} from '@/domain/recipe'

type StaleItem = { recipeId: string; locale: string; provenance: string }

/** Ingrediente COM nome (rawText presente/não-vazio) — só estes são editáveis (#498). */
type NamedIngredient = { ordem: number; rawText: string }

export function StaleTranslations() {
  const { messages } = useLocale()
  const m = messages.traducoesStale
  const sys = messages.system

  const [items, setItems] = useState<StaleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  // Editor de nomes de ingrediente (#498) — expandido no máximo UM item por vez.
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [ingLoading, setIngLoading] = useState(false)
  const [ingLoadError, setIngLoadError] = useState(false)
  const [ingredients, setIngredients] = useState<NamedIngredient[]>([])
  const [names, setNames] = useState<Record<number, string>>({})
  const [ingSaving, setIngSaving] = useState(false)
  const [ingSaveError, setIngSaveError] = useState(false)
  const [ingSaveSuccess, setIngSaveSuccess] = useState(false)

  const provenanceLabel = {
    escrita_por_pessoa: m.provEscritaPorPessoa,
    automatica_revisada: m.provAutomaticaRevisada,
    automatica_nao_revisada: m.provAutomaticaNaoRevisada,
  } satisfies Record<TranslationProvenance, string>

  function labelProvenance(value: string): string {
    return (TRANSLATION_PROVENANCES as readonly string[]).includes(value)
      ? provenanceLabel[value as TranslationProvenance]
      : value
  }

  const itemKey = (it: StaleItem) => `${it.recipeId}:${it.locale}`

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/curate/translations/stale')
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const body = (await res.json()) as { stale: StaleItem[] }
      setItems(body.stale)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Fetch num timer (não no corpo síncrono do effect) p/ não disparar setState em cascata
    // na montagem — mesmo padrão de `search-experience.tsx`. O retry redispara `load`.
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [])

  async function handleReview(item: StaleItem) {
    const key = itemKey(item)
    if (busyKey) return
    setBusyKey(key)
    setErrorKey(null)
    const snapshot = items
    setItems((prev) => prev.filter((it) => itemKey(it) !== key))
    try {
      const res = await fetch(
        `/api/recipes/${item.recipeId}/translations/${item.locale}/review`,
        { method: 'POST' },
      )
      if (!res.ok) {
        setItems(snapshot)
        setErrorKey(key)
      }
    } catch {
      setItems(snapshot)
      setErrorKey(key)
    } finally {
      setBusyKey(null)
    }
  }

  /** Reseta todo o estado do editor de nomes (usado ao fechar/trocar de item). */
  function resetIngredientEditor() {
    setIngLoading(false)
    setIngLoadError(false)
    setIngredients([])
    setNames({})
    setIngSaving(false)
    setIngSaveError(false)
    setIngSaveSuccess(false)
  }

  async function toggleEditIngredients(item: StaleItem) {
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
      const body = (await res.json()) as {
        ingredients: { ordem: number; rawText: string | null }[]
      }
      const named = body.ingredients.filter(
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

  async function saveIngredientNames(item: StaleItem) {
    if (ingSaving) return
    // Dirty-diff: só os `ordem` cujo valor mudou (trim) contra o carregado — nunca manda edits
    // vazios (o servidor rejeitaria nome em branco; aqui simplesmente não inclui no-op).
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
      // Novo baseline: um 2º salvamento sem mais mudanças vira no-op (dirty-diff contra o salvo).
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
    <section aria-labelledby="stale-titulo" className="flex flex-col gap-3">
      <h2 id="stale-titulo" className="font-display text-lg font-semibold text-fg">
        {m.titulo}
      </h2>

      {/* Região persistente com `aria-live`/`aria-busy`: anuncia o fim do loading e o que
          chegou (lista, vazio ou erro) a um leitor de tela que ficou na seção. O wrapper não é
          desmontado entre estados; só o conteúdo troca. Mesmo recorte de search-experience.tsx. */}
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
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleReview(item)}
                      disabled={busyKey === key}
                      aria-busy={busyKey === key}
                      className="disabled:opacity-70"
                    >
                      {busyKey === key ? m.marcando : m.marcarRevisada}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void toggleEditIngredients(item)}
                      aria-expanded={expanded}
                    >
                      {expanded ? m.fecharNomes : m.editarNomes}
                    </Button>
                  </div>
                  {errorKey === key && (
                    <p
                      role="alert"
                      className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
                    >
                      {m.erroGenerico}
                    </p>
                  )}
                  {expanded && (
                    <div
                      aria-live="polite"
                      aria-busy={ingLoading}
                      className="flex flex-col gap-2 rounded-md border border-border bg-bg p-3"
                    >
                      {ingLoading ? (
                        <p className="text-sm text-muted">{m.carregandoIngredientes}</p>
                      ) : ingLoadError ? (
                        <p role="alert" className="text-sm font-medium text-fg">
                          {m.erroCarregarIngredientes}
                        </p>
                      ) : ingredients.length === 0 ? (
                        <p className="text-sm text-muted">{m.semIngredientesNomeados}</p>
                      ) : (
                        <>
                          <ul className="flex flex-col gap-2">
                            {ingredients.map((ing) => (
                              <li key={ing.ordem} className="flex flex-col gap-1">
                                <label
                                  htmlFor={`ing-nome-${key}-${ing.ordem}`}
                                  className="text-xs font-medium text-muted"
                                >
                                  {m.nomeIngredienteLabel}
                                </label>
                                <Input
                                  id={`ing-nome-${key}-${ing.ordem}`}
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
                              {ingSaving ? m.salvando : m.salvarNomes}
                            </Button>
                            {ingSaveSuccess && (
                              <p className="text-sm text-muted">{m.nomesSalvos}</p>
                            )}
                          </div>
                          {ingSaveError && (
                            <p role="alert" className="text-sm font-medium text-fg">
                              {m.erroSalvarNomes}
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
