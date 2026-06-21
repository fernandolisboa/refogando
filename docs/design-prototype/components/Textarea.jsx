import React from 'react'

/** Refogando Textarea — multi-line field (chat composer, observations, bio).
 * Same family as Input; vertically resizable. Maps to shadcn/ui <Textarea>. */
export function Textarea({ className = '', style = {}, rows = 3, ...props }) {
  return (
    <textarea
      rows={rows}
      className={className}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
        lineHeight: 'var(--leading-normal)',
        color: 'var(--color-fg)',
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '0.5rem 0.75rem',
        boxShadow: 'var(--shadow-sm)',
        resize: 'vertical',
        outline: 'none',
        ...style,
      }}
      {...props}
    />
  )
}
