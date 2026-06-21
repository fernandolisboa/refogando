import React from 'react'

/**
 * Refogando Checkbox — used as a search FACET chip (issue #56). A native
 * checkbox (paprika accent) beside its label, the whole thing in a rounded
 * pill that tints when checked. Maps to shadcn/ui <Checkbox> + chip styling.
 */
export function Checkbox({ label, checked = false, onChange, className = '', style = {}, ...props }) {
  return (
    <label
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
        color: checked ? 'var(--color-brand-ink)' : 'var(--color-fg)',
        backgroundColor: checked
          ? 'color-mix(in oklch, var(--color-brand) 10%, transparent)'
          : 'var(--color-surface)',
        border: `1px solid ${checked ? 'var(--color-brand)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-full)',
        padding: '0.3125rem 0.75rem',
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'color var(--duration-base) var(--ease-out), background-color var(--duration-base) var(--ease-out), border-color var(--duration-base) var(--ease-out)',
        ...style,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        style={{ accentColor: 'var(--color-brand-strong)', width: '0.875rem', height: '0.875rem', margin: 0 }}
        {...props}
      />
      {label}
    </label>
  )
}
