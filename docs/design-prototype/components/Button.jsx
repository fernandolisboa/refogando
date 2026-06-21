import React from 'react'

/**
 * Refogando Button — canonical action vocabulary (issue #54).
 * Maps 1:1 to shadcn/ui <Button> variants. Paprika fill for primary; warm
 * neutral surface for secondary; hairline outline; bare ghost. Hover is a
 * gentle opacity drop on filled, a paprika border on outlined — never a new
 * color. Soft 10px radius, warm-brown shadow on the filled variant.
 */
export function Button({
  variant = 'default',
  size = 'md',
  as = 'button',
  className = '',
  style = {},
  children,
  ...props
}) {
  const Tag = as

  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    fontFamily: 'var(--font-sans)',
    fontWeight: 'var(--weight-medium)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid transparent',
    cursor: 'pointer',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    transition: 'color var(--duration-base) var(--ease-out), background-color var(--duration-base) var(--ease-out), border-color var(--duration-base) var(--ease-out), opacity var(--duration-base) var(--ease-out)',
  }

  const sizes = {
    sm: { fontSize: 'var(--text-sm)', padding: '0.375rem 0.875rem', lineHeight: '1.25rem' },
    md: { fontSize: 'var(--text-sm)', padding: '0.5rem 1rem', lineHeight: '1.5rem' },
    lg: { fontSize: 'var(--text-base)', padding: '0.625rem 1.25rem', lineHeight: '1.75rem' },
    icon: { fontSize: 'var(--text-sm)', padding: '0.5rem', width: '2.5rem', height: '2.5rem' },
  }

  const variants = {
    // Primary — paprika fill, white ink, warm shadow.
    default: {
      backgroundColor: 'var(--color-brand-strong)',
      color: 'var(--color-on-brand)',
      boxShadow: 'var(--shadow-sm)',
    },
    // Secondary — warm dough surface, hairline border, ink text.
    secondary: {
      backgroundColor: 'var(--color-surface)',
      color: 'var(--color-fg)',
      borderColor: 'var(--color-border)',
    },
    // Outline — same as secondary but transparent fill (sits on cards).
    outline: {
      backgroundColor: 'transparent',
      color: 'var(--color-fg)',
      borderColor: 'var(--color-border)',
    },
    // Ghost — bare, for tertiary actions and the header "Criar" CTA.
    ghost: {
      backgroundColor: 'transparent',
      color: 'var(--color-brand-ink)',
      borderColor: 'transparent',
    },
  }

  return (
    <Tag
      className={className}
      style={{ ...base, ...sizes[size], ...variants[variant], ...style }}
      onMouseEnter={(e) => {
        if (variant === 'default') e.currentTarget.style.opacity = '0.9'
        else if (variant === 'secondary' || variant === 'outline')
          e.currentTarget.style.borderColor = 'var(--color-brand-ink)'
        else if (variant === 'ghost')
          e.currentTarget.style.backgroundColor = 'color-mix(in oklch, var(--color-brand) 10%, transparent)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = ''
        e.currentTarget.style.backgroundColor = variants[variant].backgroundColor
        e.currentTarget.style.borderColor = variants[variant].borderColor || 'transparent'
      }}
      {...props}
    >
      {children}
    </Tag>
  )
}
