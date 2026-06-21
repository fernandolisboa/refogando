import React from 'react'

/**
 * Refogando Select — native select, styled (language switcher #4, structured
 * create fields #58). Native on purpose: keyboard-accessible for free, themed
 * with tokens. Maps to shadcn/ui <Select>. Chevron is a Lucide-style caret
 * baked in as a data-URI (stroke %23857667).
 */
export function Select({ className = '', style = {}, children, ...props }) {
  return (
    <select
      className={className}
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
        color: 'var(--color-fg)',
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '0.4375rem 2rem 0.4375rem 0.625rem',
        boxShadow: 'var(--shadow-sm)',
        cursor: 'pointer',
        appearance: 'none',
        backgroundImage:
          'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23857667\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'m6 9 6 6 6-6\'/%3E%3C/svg%3E")',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.5rem center',
        ...style,
      }}
      {...props}
    >
      {children}
    </select>
  )
}
