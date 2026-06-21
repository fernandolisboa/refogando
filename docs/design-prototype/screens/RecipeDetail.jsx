/* Refogando — recipe detail (#57). Title + provenance + ingredients + steps +
   restriction warning + engagement. Composes Badge, Alert, EngagementControls. */
const RDSd = window.RefogandoDesignSystem_b03ee4

function Chip({ children, full }) {
  return (
    <li style={{
      display: 'inline-flex', alignItems: 'center',
      border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)',
      color: 'var(--color-muted)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)',
      padding: '0.125rem 0.5rem', borderRadius: full ? 'var(--radius-full)' : 'var(--radius-sm)',
    }}>{children}</li>
  )
}

function Meta({ label, value }) {
  return (
    <React.Fragment>
      <dt style={{ fontWeight: 'var(--weight-medium)', color: 'var(--color-muted)' }}>{label}</dt>
      <dd style={{ color: 'var(--color-fg)', margin: 0 }}>{value}</dd>
    </React.Fragment>
  )
}

function RecipeDetail({ recipe, onBack, onAuthor }) {
  const r = recipe
  const [voted, setVoted] = React.useState(r.voted)
  const [fav, setFav] = React.useState(r.favorited)
  const [votes, setVotes] = React.useState(r.votes)
  const seal = { catalogo: 'Do catálogo', comunidade: 'Da comunidade', minha: 'Sua receita' }[r.provenance]
  const inPool = r.votes != null

  return (
    <main style={{ maxWidth: '52rem', margin: '0 auto', padding: 'var(--space-8) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <a href="#" onClick={(e) => { e.preventDefault(); onBack() }} style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', textDecoration: 'none' }}>← Voltar à busca</a>

      <header style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <RDSd.Badge variant={r.provenance} style={{ alignSelf: 'flex-start' }}>{seal}</RDSd.Badge>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-4xl)', fontWeight: 'var(--weight-semibold)', letterSpacing: '-0.02em', color: 'var(--color-fg)' }}>{r.title}</h1>
        {r.author && r.author.handle !== 'voce' && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', margin: 0 }}>
            <a href="#" onClick={(e) => { e.preventDefault(); onAuthor(r.author.handle) }} style={{ color: 'inherit', textDecoration: 'none' }}>por {r.author.name}</a>
          </p>
        )}
      </header>

      {r.avisos.map((a, i) => (
        <RDSd.Alert key={i} variant="aviso" title={a.title}>{a.body}</RDSd.Alert>
      ))}

      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto 1fr', columnGap: 'var(--space-8)', rowGap: 'var(--space-2)', fontSize: 'var(--text-sm)', margin: 0, alignContent: 'start' }}>
        <Meta label="Porções" value={r.porcoes} />
        <Meta label="Dificuldade" value={`${r.dificuldade}/5`} />
        <Meta label="Cozinha" value={r.cozinha} />
        <Meta label="Categoria" value={r.categoria} />
      </dl>

      {r.restricoes.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <p style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-muted)', margin: 0 }}>Restrições</p>
          <ul style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', listStyle: 'none', padding: 0, margin: 0 }}>
            {r.restricoes.map((x) => <Chip key={x} full>{x}</Chip>)}
          </ul>
        </section>
      )}

      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-fg)' }}>Descrição</h2>
        <p style={{ maxWidth: 'var(--measure)', color: 'var(--color-fg)', margin: 0, lineHeight: 'var(--leading-normal)' }}>{r.descricao}</p>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-fg)' }}>Ingredientes</h2>
        <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', maxWidth: 'var(--measure)', color: 'var(--color-fg)', listStyle: 'none', padding: 0, margin: 0 }}>
          {r.ingredientes.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-fg)' }}>Modo de preparo</h2>
        <ol style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxWidth: 'var(--measure)', color: 'var(--color-fg)', paddingLeft: '1.25rem', margin: 0 }}>
          {r.passos.map((p, i) => <li key={i} style={{ paddingLeft: '0.25rem', lineHeight: 'var(--leading-normal)' }}>{p}</li>)}
        </ol>
      </section>

      {inPool && (
        <RDSd.EngagementControls
          title="Comunidade"
          countLabel={`${votes} ${votes === 1 ? 'voto' : 'votos'}`}
          voted={voted} favorited={fav}
          voteLabel="Votar" votedLabel="Votado"
          favoriteLabel="Favoritar" favoritedLabel="Favoritado"
          onVote={() => { setVoted((v) => { setVotes((c) => c + (v ? -1 : 1)); return !v }) }}
          onFavorite={() => setFav((f) => !f)}
        />
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', paddingTop: 'var(--space-2)' }}>
        <RDSd.Button variant="secondary">Criar minha versão</RDSd.Button>
        {r.provenance === 'minha' && <RDSd.Button variant="secondary">Editar</RDSd.Button>}
        {r.provenance === 'minha' && <RDSd.Button>Publicar</RDSd.Button>}
      </div>
    </main>
  )
}

window.RecipeDetail = RecipeDetail
