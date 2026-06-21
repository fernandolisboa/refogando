import React from 'react'

/**
 * Refogando Alert — the restriction warning (issue #7) and neutral notices.
 * Maps to shadcn/ui <Alert> with a custom AMBER "aviso" variant. A LIGHT
 * touch: it informs ("declared, not verified"), it NEVER blocks or suppresses
 * reading. role="note" (not "alert") so it doesn't interrupt the screen reader.
 *
 *   aviso → amber (restriction contradiction — never red)
 *   info  → neutral (stale translation, system notices)
 */
export function Alert({ variant = 'aviso', title, className = '', style = {}, children, ...props }) {
  const variants = {
    aviso: {
      backgroundColor: 'var(--color-aviso-bg)',
      color: 'var(--color-aviso-fg)',
      borderColor: 'color-mix(in oklch, var(--color-aviso-fg) 30%, transparent)',
    },
    info: {
      backgroundColor: 'var(--color-surface)',
      color: 'var(--color-fg)',
      borderColor: 'var(--color-border)',
    },
  }

  return (
    <div
      role="note"
      aria-label={title}
      className={className}
      style={{
        borderRadius: 'var(--radius-md)',
        border: '1px solid',
        padding: '0.75rem 1rem',
        fontFamily: 'var(--font-sans)',
        ...variants[variant],
        ...style,
      }}
      {...props}
    >
      {title && (
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' }}>
          {title}
        </p>
      )}
      <p style={{ margin: title ? '0.25rem 0 0' : 0, fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-normal)' }}>
        {children}
      </p>
    </div>
  )
}
