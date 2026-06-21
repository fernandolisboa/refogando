import React from 'react'
import { Button } from './Button.jsx'

/**
 * Refogando ToggleGroup — segmented control (issue #62, #88). Sort
 * (Relevância ↔ Popularidade) and create-mode (Estruturado ↔ Conversa)
 * switches. Active option = paprika fill (Button default sm), inactive =
 * neutral surface (Button secondary sm) — identical padding so selection
 * never jumps. Maps to shadcn/ui <ToggleGroup> / <Tabs>.
 */
export function ToggleGroup({ label, value, onChange, options = [], className = '', style = {} }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={className}
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)', ...style }}
    >
      {label && (
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>{label}</span>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        {options.map((opt) => {
          const active = value === opt.key
          return (
            <Button
              key={opt.key}
              size="sm"
              variant={active ? 'default' : 'secondary'}
              aria-pressed={active}
              onClick={() => onChange && onChange(opt.key)}
            >
              {opt.label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
