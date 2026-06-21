import React from 'react'

/**
 * Refogando Avatar — author / profile image (issue #129). Round, dough
 * surface fallback with display-serif initials. Maps to shadcn/ui <Avatar>.
 * Fallback bg = accent-surface (herb), color = accent-strong; serif initials.
 */
export function Avatar({ src, name = '', size = 40, className = '', style = {} }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: 'var(--radius-full)',
        overflow: 'hidden',
        flex: 'none',
        backgroundColor: 'var(--color-accent-surface)',
        color: 'var(--color-accent-strong)',
        border: '1px solid var(--color-border)',
        fontFamily: 'var(--font-display)',
        fontSize: Math.round(size * 0.4),
        fontWeight: 'var(--weight-semibold)',
        userSelect: 'none',
        ...style,
      }}
      aria-label={name || undefined}
    >
      {src ? (
        <img src={src} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        initials || '·'
      )}
    </span>
  )
}
