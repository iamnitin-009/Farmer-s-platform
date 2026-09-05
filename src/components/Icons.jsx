// Small, hand-written SVG icons. Keeping these as plain SVG (instead of
// pulling in an icon library) keeps the project's dependency list tiny.
// Each icon is a simple React component so it can be used like <IconLeaf />.

export function IconLeaf(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" {...props}>
      <path
        d="M4 20c0-8 5-14 15-14 0 10-6 15-14 15-1.5 0-1-1-1-1z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M5.5 19 15 9.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function IconScan(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" {...props}>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export function IconTag(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" {...props}>
      <path d="M11.5 4h5A1.5 1.5 0 0 1 18 5.5v5a1.5 1.5 0 0 1-.44 1.06l-7 7a1.5 1.5 0 0 1-2.12 0l-5-5a1.5 1.5 0 0 1 0-2.12l7-7A1.5 1.5 0 0 1 11.5 4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="14.5" cy="8.5" r="1.1" fill="currentColor" />
    </svg>
  )
}

export function IconHandshake(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" {...props}>
      <path d="M2 12.5 6 9l3.2 2.6M22 12.5 18 9l-3.2 2.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M9.2 11.6 12 14l-1.3 1.3a1.5 1.5 0 0 1-2.1 0v0a1.5 1.5 0 0 1 0-2.1L9.2 11.6ZM14.8 11.6 12 14l1.3 1.3a1.5 1.5 0 0 0 2.1 0v0a1.5 1.5 0 0 0 0-2.1l-.6-.6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

export function IconPin(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" {...props}>
      <path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="9.5" r="2.3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export function IconBoxes(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" {...props}>
      <rect x="3" y="10" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="14" y="10" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="8.5" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export function IconRoute(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" {...props}>
      <circle cx="5" cy="6" r="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="19" cy="18" r="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 8v3a4 4 0 0 0 4 4h6a4 4 0 0 1 4 4" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.5 2.5" />
    </svg>
  )
}

export function IconMic(props) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.5 11.5A6.5 6.5 0 0 0 12 18a6.5 6.5 0 0 0 6.5-6.5M12 18v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function IconSprout(props) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" {...props}>
      <path d="M12 21v-8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 13c0-4-3-6-7-6 0 4 3 6 7 6ZM12 10c0-4 3-6 7-6 0 4-3 6-7 6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

export function IconBasket(props) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" {...props}>
      <path d="M4 10h16l-1.6 9.2a2 2 0 0 1-2 1.8H7.6a2 2 0 0 1-2-1.8L4 10Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8 10 9.5 4M16 10 14.5 4M2.5 10h19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
