/* Refogando — Home = Search (the search IS the home, #56). Initial / loading /
   empty / error / results states. Composes RecipeCard, Checkbox, ToggleGroup. */
const RDS = window.RefogandoDesignSystem_b03ee4

function FacetRow({ legend, options, selected, onToggle }) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <legend style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-fg)', padding: 0, marginBottom: 2 }}>{legend}</legend>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        {options.map((o) => (
          <RDS.Checkbox key={o} label={o} checked={selected.includes(o)} onChange={() => onToggle(o)} />
        ))}
      </div>
    </fieldset>
  )
}

function Section({ heading, recipes, onOpen }) {
  if (recipes.length === 0) return null
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-fg)' }}>{heading}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 'var(--space-4)' }}>
        {recipes.map((r) => (
          <div key={r.id} onClickCapture={(e) => { e.preventDefault(); onOpen(r.id) }} style={{ cursor: 'pointer' }}>
            <RecipeCard
              title={r.title}
              provenance={r.provenance}
              author={r.author && r.author.handle !== 'voce' ? r.author : undefined}
              autoTranslated={r.autoTranslated}
              autoTranslatedLabel="tradução automática"
              href="#"
            />
          </div>
        ))}
      </div>
    </section>
  )
}

function HomeSearch({ onOpen }) {
  const data = window.RefoData
  const [q, setQ] = React.useState('')
  const [cozinha, setCozinha] = React.useState([])
  const [restricao, setRestricao] = React.useState([])
  const [sort, setSort] = React.useState('relevancia')
  const [state, setState] = React.useState('idle') // idle | loading | error | done

  const toggle = (setter) => (v) => setter((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])
  const hasCriteria = q.trim() !== '' || cozinha.length > 0 || restricao.length > 0

  React.useEffect(() => {
    if (!hasCriteria) { setState('idle'); return }
    setState('loading')
    const t = setTimeout(() => setState('done'), 450)
    return () => clearTimeout(t)
  }, [q, cozinha, restricao, sort])

  const filtered = data.recipes.filter((r) => {
    const text = (q.trim() === '') || r.title.toLowerCase().includes(q.trim().toLowerCase()) || r.descricao.toLowerCase().includes(q.trim().toLowerCase())
    const coz = cozinha.length === 0 || cozinha.includes(r.cozinha)
    const res = restricao.length === 0 || restricao.every((x) => r.restricoes.includes(x))
    return text && coz && res
  })
  const mine = filtered.filter((r) => r.provenance === 'minha')
  const catalogo = filtered.filter((r) => r.provenance === 'catalogo')
  const comunidade = filtered.filter((r) => r.provenance === 'comunidade')
  const isEmpty = state === 'done' && filtered.length === 0

  return (
    <main style={{ maxWidth: 'var(--container-page)', margin: '0 auto', padding: 'var(--space-8) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-4xl)', fontWeight: 'var(--weight-semibold)', letterSpacing: '-0.02em', color: 'var(--color-fg)' }}>Buscar receitas</h1>

      <form role="search" onSubmit={(e) => e.preventDefault()} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <RDS.Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Digite um prato, ingrediente ou estilo culinário" style={{ flex: '1 1 280px', minWidth: 0 }} />
        <RDS.Button>Buscar</RDS.Button>
      </form>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <FacetRow legend="Cozinha" options={data.cozinhas} selected={cozinha} onToggle={toggle(setCozinha)} />
        <FacetRow legend="Restrição" options={data.restricoesFiltro} selected={restricao} onToggle={toggle(setRestricao)} />
        {hasCriteria && (
          <RDS.ToggleGroup
            label="Ordenar a Comunidade por"
            value={sort}
            onChange={setSort}
            options={[{ key: 'relevancia', label: 'Relevância' }, { key: 'popularidade', label: 'Popularidade' }]}
          />
        )}
      </div>

      <div aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
        {state === 'idle' && <p style={{ color: 'var(--color-muted)' }}>Comece digitando um prato, ingrediente ou estilo que você curte — ou use os filtros.</p>}
        {state === 'loading' && <p style={{ color: 'var(--color-muted)' }}>Carregando…</p>}
        {isEmpty && <p style={{ color: 'var(--color-muted)' }}>Nenhuma receita encontrada. Tente outro termo ou ajuste os filtros.</p>}
        {state === 'done' && filtered.length > 0 && (
          <React.Fragment>
            <Section heading="Minhas" recipes={mine} onOpen={onOpen} />
            <Section heading="Catálogo" recipes={catalogo} onOpen={onOpen} />
            <Section heading="Comunidade" recipes={comunidade} onOpen={onOpen} />
          </React.Fragment>
        )}
      </div>
    </main>
  )
}

window.HomeSearch = HomeSearch
