import React from 'react'
import { Button } from './Button.jsx'

/**
 * Refogando EngagementControls — community vote + favorite (issue #62). Vote
 * count is read-only; vote/favorite are optimistic toggles. Active = paprika
 * fill, inactive = neutral. Popularity is a separate axis and NEVER colors
 * trust (no herb green, no amber here). Composes Button.
 */
export function EngagementControls({
  title = 'Comunidade',
  voteCount,
  voted = false,
  favorited = false,
  onVote,
  onFavorite,
  voteLabel = 'Votar',
  votedLabel = 'Votado',
  favoriteLabel = 'Favoritar',
  favoritedLabel = 'Favoritado',
  countLabel,
  className = '',
  style = {},
}) {
  return (
    <section
      aria-label={title}
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
        padding: '0.75rem 1rem',
        ...style,
      }}
    >
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-fg)', margin: 0 }}>
        {title}
      </h2>
      {countLabel != null && (
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>{countLabel}</span>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        {onVote && (
          <Button variant={voted ? 'default' : 'secondary'} aria-pressed={voted} onClick={onVote}>
            {voted ? votedLabel : voteLabel}
          </Button>
        )}
        <Button variant={favorited ? 'default' : 'secondary'} aria-pressed={favorited} onClick={onFavorite}>
          {favorited ? favoritedLabel : favoriteLabel}
        </Button>
      </div>
    </section>
  )
}
