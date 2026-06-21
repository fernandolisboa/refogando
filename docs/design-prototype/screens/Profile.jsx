/* Refogando — public profile /u/<handle> (#129). Avatar + name + bio + links +
   that person's public recipes. Composes Avatar, Badge, RecipeCard. */
const RDSp = window.RefogandoDesignSystem_b03ee4

function Profile({ handle, onOpen, onBack }) {
  const profiles = {
    ana: { name: 'Ana Prado', bio: 'Cozinheira caseira de Salvador. Dendê em quase tudo, coentro sempre.', links: [['Instagram', '@anacozinha'], ['Site', 'anaprado.com']] },
    beto: { name: 'Beto Lima', bio: 'Mineiro, fim de semana é dia de bolo. Forno sempre quente.', links: [['YouTube', '@betonacozinha']] },
    voce: { name: 'Você', bio: 'Suas criações e experimentos com a IA.', links: [] },
  }
  const p = profiles[handle] || profiles.ana
  const recipes = window.RefoData.recipes.filter((r) => r.author && r.author.handle === handle && r.provenance !== 'minha')
  const shown = recipes.length > 0 ? recipes : window.RefoData.recipes.filter((r) => r.provenance === 'comunidade').slice(0, 2)

  return (
    <main style={{ maxWidth: '52rem', margin: '0 auto', padding: 'var(--space-8) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <a href="#" onClick={(e) => { e.preventDefault(); onBack() }} style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)', textDecoration: 'none' }}>← Voltar</a>

      <header style={{ display: 'flex', gap: 'var(--space-5)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <RDSp.Avatar name={p.name} size={72} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', flex: '1 1 240px' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-semibold)', letterSpacing: '-0.02em', color: 'var(--color-fg)' }}>{p.name}</h1>
          <p style={{ color: 'var(--color-fg)', margin: 0, maxWidth: '52ch', lineHeight: 'var(--leading-normal)' }}>{p.bio}</p>
          {p.links.length > 0 && (
            <ul style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', listStyle: 'none', padding: 0, margin: '0.25rem 0 0' }}>
              {p.links.map(([t, v]) => (
                <li key={t}><a href="#" onClick={(e) => e.preventDefault()} style={{ fontSize: 'var(--text-sm)', color: 'var(--color-brand-ink)', textDecoration: 'none' }}>{t} · {v}</a></li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-fg)' }}>Receitas</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 'var(--space-4)' }}>
          {shown.map((r) => (
            <div key={r.id} onClickCapture={(e) => { e.preventDefault(); onOpen(r.id) }} style={{ cursor: 'pointer' }}>
              <RecipeCard title={r.title} provenance={r.provenance} href="#" />
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

window.Profile = Profile
