/* Refogando app — sticky header (wordmark + nav + language). Composes DS Button. */
const { Button: RefoButton, Select: RefoSelect } = window.RefogandoDesignSystem_b03ee4

function Header({ route, onNavigate, locale, onLocale, authed }) {
  const link = (key, label) => (
    <a
      href="#"
      onClick={(e) => { e.preventDefault(); onNavigate(key) }}
      style={{
        fontSize: 'var(--text-sm)',
        fontWeight: 'var(--weight-medium)',
        color: route === key ? 'var(--color-fg)' : 'var(--color-muted)',
        textDecoration: 'none',
        transition: 'color var(--duration-base) var(--ease-out)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-fg)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = route === key ? 'var(--color-fg)' : 'var(--color-muted)')}
    >
      {label}
    </a>
  )

  return (
    <header
      style={{
        position: 'sticky', top: 0, zIndex: 40,
        borderBottom: '1px solid var(--color-border)',
        backgroundColor: 'color-mix(in oklch, var(--color-bg) 95%, transparent)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div style={{ maxWidth: 'var(--container-page)', margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 'var(--space-6)', rowGap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', minHeight: 64, boxSizing: 'border-box' }}>
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); onNavigate('home') }}
          style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)', letterSpacing: '-0.02em', color: 'var(--color-brand-ink)', textDecoration: 'none' }}
        >
          Refogando
        </a>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
          {link('home', 'Início')}
          {link('recipes', 'Receitas')}
          {authed && link('mine', 'Minhas criações')}
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); onNavigate('create') }}
            style={{
              borderRadius: 'var(--radius-md)',
              border: '1px solid color-mix(in oklch, var(--color-brand) 60%, transparent)',
              padding: '0.375rem 0.75rem', fontSize: 'var(--text-sm)',
              color: 'var(--color-brand-ink)', textDecoration: 'none',
              transition: 'background-color var(--duration-base) var(--ease-out), border-color var(--duration-base) var(--ease-out)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'color-mix(in oklch, var(--color-brand) 10%, transparent)'; e.currentTarget.style.borderColor = 'var(--color-brand)' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = 'color-mix(in oklch, var(--color-brand) 60%, transparent)' }}
          >
            Criar
          </a>
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <RefoSelect value={locale} onChange={(e) => onLocale(e.target.value)} aria-label="Idioma" style={{ fontSize: 'var(--text-xs)', padding: '0.3125rem 1.75rem 0.3125rem 0.5rem' }}>
            <option value="pt-BR">PT-BR</option>
            <option value="en-US">EN-US</option>
          </RefoSelect>
          {authed
            ? <RefoButton variant="ghost" size="sm" onClick={() => onNavigate('profile')}>Você</RefoButton>
            : <RefoButton variant="secondary" size="sm">Entrar</RefoButton>}
        </div>
      </div>
    </header>
  )
}

window.Header = Header
