import React from 'react'

/** Refogando Label — field label. Maps to shadcn/ui <Label>. Medium weight,
 * fg color; pair with htmlFor. */
export function Label({ className = '', style = {}, children, ...props }) {
  return (
    <label
      className={className}
      style={{
        display: 'inline-block',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
        fontWeight: 'var(--weight-medium)',
        color: 'var(--color-fg)',
        ...style,
      }}
      {...props}
    >
      {children}
    </label>
  )
}
