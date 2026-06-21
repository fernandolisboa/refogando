import React from 'react'

/**
 * Refogando Input — canonical field style (issue #54). Maps to shadcn/ui
 * <Input>. Dough surface, hairline border, warm-brown inner shadow, muted
 * placeholder. Visible focus ring via the global :focus-visible.
 */
export function Input({ className = '', style = {}, type = 'text', ...props }) {
  return (
    <input
      type={type}
      className={className}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
        color: 'var(--color-fg)',
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '0.5rem 0.75rem',
        boxShadow: 'var(--shadow-sm)',
        outline: 'none',
        ...style,
      }}
      {...props}
    />
  )
}
