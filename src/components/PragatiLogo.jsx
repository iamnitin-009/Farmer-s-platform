// PRAGATI Brand Logo & Wordmark Component
// Represents Agriculture (sprout/leaf), Progress (upward vector/arrow), and Technology (golden marketplace node)

export function PragatiSymbol({ size = 36, className = '' }) {
  return (
    <svg
      className={`pragati-symbol-svg ${className}`}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="pragatiLeafGrad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#15803d" />
          <stop offset="60%" stopColor="#16a34a" />
          <stop offset="100%" stopColor="#22c55e" />
        </linearGradient>
        <linearGradient id="pragatiArrowGrad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#047857" />
          <stop offset="50%" stopColor="#059669" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
        <linearGradient id="pragatiSunGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fde047" />
          <stop offset="60%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <filter id="pragatiGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#047857" floodOpacity="0.25" />
        </filter>
      </defs>

      {/* Rounded Squircle Container Badge */}
      <rect width="48" height="48" rx="12" fill="#064e3b" fillOpacity="0.12" />

      <g filter="url(#pragatiGlow)">
        {/* Left Sprout Leaf (Agriculture & Vitality) */}
        <path
          d="M24 40.5C14.8 40.5 8.5 32.5 8.5 22C8.5 13.2 15 7.5 24 5.5C20.2 13.5 19 25 24 40.5Z"
          fill="url(#pragatiLeafGrad)"
        />

        {/* Dynamic Upward Growth Wing / Arrow (Progress / Pragati) */}
        <path
          d="M24 5.5C28.8 9.5 38 16.8 39 26C39.8 33.2 34.5 39.5 25.5 40.5C29.2 32.2 29.5 21.8 24 16V5.5Z"
          fill="url(#pragatiArrowGrad)"
          opacity="0.95"
        />

        {/* Central Ascending Light Ridge */}
        <path
          d="M24 9.5L24 37"
          stroke="#ffffff"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeDasharray="1.5 3"
          opacity="0.75"
        />

        {/* Golden Sun & Connected Technology Node */}
        <circle cx="35" cy="11.5" r="4" fill="url(#pragatiSunGrad)" />
        <circle cx="35" cy="11.5" r="1.5" fill="#ffffff" opacity="0.8" />
      </g>
    </svg>
  )
}

export default function PragatiLogo({
  size = 'md', // 'sm' | 'md' | 'lg'
  variant = 'light', // 'light' (for dark surfaces like header) | 'dark' (for light cards)
  showTagline = false,
  taglineText = 'Agricultural Marketplace',
  iconOnly = false,
  className = '',
  style = {},
}) {
  const pixelSizes = {
    sm: 28,
    md: 36,
    lg: 48,
  }

  const iconPx = pixelSizes[size] || 36

  return (
    <div
      className={`pragati-brand-logo pragati-logo-${size} pragati-logo-${variant} ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size === 'sm' ? '8px' : size === 'lg' ? '14px' : '10px',
        textDecoration: 'none',
        userSelect: 'none',
        ...style,
      }}
    >
      <div className="pragati-symbol-wrapper" style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <PragatiSymbol size={iconPx} />
      </div>

      {!iconOnly && (
        <div className="pragati-wordmark-wrapper" style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <span
            className="pragati-wordmark-text"
            style={{
              fontFamily: 'var(--font-heading, "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
              fontWeight: 850,
              letterSpacing: '0.08em',
              fontSize: size === 'sm' ? '1.1rem' : size === 'lg' ? '1.65rem' : '1.3rem',
              color: variant === 'light' ? '#ffffff' : '#0f172a',
              textTransform: 'uppercase',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            PRAGATI
          </span>

          {showTagline && (
            <span
              className="pragati-tagline-text"
              style={{
                fontSize: size === 'sm' ? '0.72rem' : size === 'lg' ? '0.86rem' : '0.78rem',
                color: variant === 'light' ? '#cddccb' : '#64748b',
                fontWeight: 500,
                letterSpacing: '0.01em',
                marginTop: '1px',
              }}
            >
              {taglineText}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
