/* Refogando app — shell footer (wordmark + tagline + presentation controls).
   #162: o seletor de IDIOMA mudou do header pro footer, ao lado do toggle de tema —
   espelha src/components/site-footer.tsx. O header fica só com [wordmark, nav, conta]. */
const { Select: RefoSelect, Button: RefoFooterButton } = window.RefogandoDesignSystem_b03ee4

function Footer({ locale, onLocale }) {
  return (
    <footer style={{ borderTop: '1px solid var(--color-border)' }}>
      <div
        style={{
          maxWidth: 'var(--container-page)', margin: '0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 'var(--space-4)', padding: 'var(--space-8) var(--space-4)', boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-brand-ink)' }}>
            Refogando
          </span>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>
            Cozinhe com o que você tem.
          </span>
        </div>
        {/* Controles de apresentação da chrome (#162): idioma + tema, lado a lado. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <RefoSelect value={locale} onChange={(e) => onLocale(e.target.value)} aria-label="Idioma" style={{ fontSize: 'var(--text-xs)', padding: '0.3125rem 1.75rem 0.3125rem 0.5rem' }}>
            <option value="pt-BR">PT-BR</option>
            <option value="en-US">EN-US</option>
          </RefoSelect>
          {/* ThemeToggle (ADR-0018): ghost + size=icon, ícone Lucide (sem emoji — regra do README). */}
          <RefoFooterButton variant="ghost" size="icon" aria-label="Tema escuro">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
          </RefoFooterButton>
        </div>
      </div>
    </footer>
  )
}

window.Footer = Footer
