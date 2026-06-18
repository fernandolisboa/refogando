'use client'

/**
 * Curadoria de catálogo (#63, AC3) — Curador+ (o servidor reforça requireRole 'curador').
 *
 * ADR-0010: consome `GET /api/curate/promotion` (ingredientes livres recorrentes) + `POST
 * /api/curate/ingredients` (cria canônico) via `fetch` (NÃO Server Action). Catálogo é a
 * coleção editorial (origin=catalog); promover um ingrediente cresce a base canônica
 * (CONTEXT.md). Promover é otimista (remove o item) e REVERTE no erro. SEM `router.refresh()`.
 *
 * O backend exige `{ translations:[{ locale, nome }] }`; o MVP coerente usa o `rawText`
 * recorrente como `nome` no locale ATUAL (form completo de tradução = polish). Subseção B é
 * info-only: a criação estruturada de Receita de catálogo entra num próximo passo (a rota
 * existe, mas o form é grande e não há AC aqui). Cores: só neutros/brand AA; sem âmbar/accent.
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { btnPrimarySm, btnSecondarySm } from '@/components/button'

type PromotionItem = { rawText: string; count: number }

export function CatalogCuration() {
  const { messages, locale } = useLocale()
  const m = messages.curadoria
  const sys = messages.system

  const [items, setItems] = useState<PromotionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busyRaw, setBusyRaw] = useState<string | null>(null)
  const [errorRaw, setErrorRaw] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<'erroSlugEmUso' | 'erroGenerico' | null>(null)

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/curate/promotion')
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const body = (await res.json()) as { promotion: PromotionItem[] }
      setItems(body.promotion)
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

  async function handlePromote(item: PromotionItem) {
    if (busyRaw) return
    setBusyRaw(item.rawText)
    setErrorRaw(null)
    setErrorKey(null)
    const snapshot = items
    setItems((prev) => prev.filter((it) => it.rawText !== item.rawText))
    try {
      const res = await fetch('/api/curate/ingredients', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ translations: [{ locale, nome: item.rawText }] }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setItems(snapshot)
        setErrorRaw(item.rawText)
        setErrorKey(body?.error === 'slug_em_uso' ? 'erroSlugEmUso' : 'erroGenerico')
      }
    } catch {
      setItems(snapshot)
      setErrorRaw(item.rawText)
      setErrorKey('erroGenerico')
    } finally {
      setBusyRaw(null)
    }
  }

  return (
    <section aria-labelledby="curadoria-titulo" className="flex flex-col gap-4">
      <h2 id="curadoria-titulo" className="font-display text-lg font-semibold text-fg">
        {m.titulo}
      </h2>

      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-fg">{m.ingredientesTitulo}</h3>

        {/* Região persistente com `aria-live`/`aria-busy`: anuncia o fim do loading e o que
            chegou (lista, vazio ou erro) a um leitor de tela que ficou na seção. O wrapper não
            é desmontado entre estados; só o conteúdo troca. Recorte de search-experience.tsx. */}
        <div aria-live="polite" aria-busy={loading} className="flex flex-col gap-2">
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
              <button type="button" onClick={() => void load()} className={btnPrimarySm}>
                {sys.retry}
              </button>
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted">{m.promocaoVazia}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li
                  key={item.rawText}
                  className="flex flex-col gap-2 rounded-md border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-sm text-fg">
                    <span className="font-medium">{item.rawText}</span>
                    <span className="text-muted">
                      {' · '}
                      {m.aparicoes}: {item.count}
                    </span>
                  </span>
                  <div className="flex flex-col items-start gap-1">
                    <button
                      type="button"
                      onClick={() => void handlePromote(item)}
                      disabled={busyRaw === item.rawText}
                      aria-busy={busyRaw === item.rawText}
                      className={`${btnSecondarySm} disabled:opacity-70`}
                    >
                      {busyRaw === item.rawText ? m.promovendo : m.promover}
                    </button>
                    {errorRaw === item.rawText && errorKey && (
                      <p
                        role="alert"
                        className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
                      >
                        {m[errorKey]}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Subseção B é info-only (a criação estruturada de Receita de catálogo entra depois).
          Tratamento de "em breve": h3 rebaixado (não compete com a subseção funcional acima) e
          aviso neutro emoldurado — o mesmo vocabulário dos avisos neutros do console — para
          ler como decisão de design, não como pendência esquecida. */}
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-muted">{m.criarReceitaTitulo}</h3>
        <p className="max-w-prose rounded-md border border-border bg-bg px-3 py-2 text-sm text-muted">
          {m.criarReceitaInfo}
        </p>
      </div>
    </section>
  )
}
