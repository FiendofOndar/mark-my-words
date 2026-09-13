/**
 * A turning ring for anything the app is actively doing: reading a claim,
 * running a check, drawing a card, asking the provider about a key.
 *
 * Every one of those used to be a label change alone ("Reading it...") and
 * the owner could not tell a slow call from a hung one. The ring says
 * something is in motion; the label says what. Inherits colour so it sits
 * inside a button or a hint at that text's weight.
 */
export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      className={`inline-block shrink-0 animate-spin align-[-0.15em] [animation-duration:0.9s] ${className}`}
    >
      <circle cx="12" cy="12" r="9" className="opacity-25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

/** A label with the ring in front of it, for a button in its busy state. */
export function Busy({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Spinner />
      {children}
    </span>
  );
}
