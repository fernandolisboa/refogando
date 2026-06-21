import React from 'react'
import { Badge } from './Badge.jsx'

/**
 * Refogando RecipeCard — one search result (issue #56). Composes Badge for the
 * always-visible provenance seal. The whole card is a focusable link to the
 * recipe; the author byline is a SIBLING link (nested links are invalid HTML).
 * Maps to shadcn/ui <Card>.
 *
 *   provenance: 'catalogo' | 'comunidade' | 'minha'  → which seal
 *   title:    display title (original + reliable translation in parentheses)
 *   author:   { name, handle }  → "por <name>" byline, links /u/<handle>
 *   autoTranslated: true        → discreet "tradução automática" mark
 *
 * Card: radius-lg, surface bg, hairline border, shadow-sm → shadow-md on hover.
 */
export function RecipeCard({
  title,
  provenance = 'comunidade',
  sealLabel,
  author,
  byLabel = 'por {name}',
  autoTranslated = false,
  autoTranslatedLabel = 'tradução automática',
  href = '#',
  className = '',
  style = {},
}) {
  const seals = {
    catalogo: sealLabel || 'Do catálogo',
    comunidade: sealLabel || 'Da comunidade',
    minha: sealLabel || 'Sua receita',
  }

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.375rem',
        height: '100%',
        boxSizing: 'border-box',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
        padding: 'var(--space-4)',
        boxShadow: 'var(--shadow-sm)',
        transition: 'box-shadow var(--duration-base) var(--ease-out)',
        ...style,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.boxShadow = 'var(--shadow-md)')}
      onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'var(--shadow-sm)')}
    >
      <a
        href={href}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          textDecoration: 'none',
          color: 'inherit',
        }}
      >
        <Badge variant={provenance} style={{ alignSelf: 'flex-start' }}>
          {seals[provenance]}
        </Badge>
        <h3
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-lg)',
            color: 'var(--color-fg)',
            margin: 0,
          }}
        >
          {title}
        </h3>
        {autoTranslated && (
          <Badge variant="auto">{autoTranslatedLabel}</Badge>
        )}
      </a>
      {author && (
        <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
          <a
            href={`/u/${author.handle}`}
            style={{ color: 'inherit', textDecoration: 'none' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-fg)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-muted)')}
          >
            {byLabel.replace('{name}', author.name)}
          </a>
        </p>
      )}
    </div>
  )
}
