import React from 'react'

/**
 * Refogando Badge — the always-visible PROVENANCE seal (issue #56) plus neutral
 * state labels. Maps to shadcn/ui <Badge>, one variant per type. The variant
 * encodes meaning, never decoration:
 *
 *   catalogo   → herb green tint  (curated catalog, origin=catalog)
 *   minha      → paprika ink + brand border (the viewer's own recipe)
 *   comunidade → neutral muted     (published by the community)
 *   neutral    → neutral muted     (state seals: Privada, Derivada, Regenerada…)
 *   auto       → bare muted text   ("tradução automática" auto-translation mark)
 *
 * Amber is RESERVED for the restriction Alert and is never used here. Herb
 * green is reserved for the catalog and never used for community.
 */
export function Badge({ variant = 'comunidade', className = '', style = {}, children, ...props }) {
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-1)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-xs)',
    fontWeight: 'var(--weight-medium)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.125rem 0.5rem',
    border: '1px solid transparent',
    whiteSpace: 'nowrap',
    lineHeight: 1.4,
  }

  const variants = {
    catalogo: {
      backgroundColor: 'var(--color-accent-surface)',
      color: 'var(--color-accent-strong)',
    },
    minha: {
      backgroundColor: 'var(--color-surface)',
      color: 'var(--color-brand-ink)',
      borderColor: 'var(--color-brand)',
    },
    comunidade: {
      backgroundColor: 'var(--color-surface)',
      color: 'var(--color-muted)',
      borderColor: 'var(--color-border)',
    },
    neutral: {
      backgroundColor: 'var(--color-surface)',
      color: 'var(--color-muted)',
      borderColor: 'var(--color-border)',
    },
    // Auto-translation mark — bare, discreet (a light touch, not an error).
    auto: {
      backgroundColor: 'transparent',
      color: 'var(--color-muted)',
      padding: 0,
      fontWeight: 'var(--weight-normal)',
    },
  }

  return (
    <span className={className} style={{ ...base, ...variants[variant], ...style }} {...props}>
      {children}
    </span>
  )
}
