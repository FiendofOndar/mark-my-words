/**
 * A small, consistent icon set.
 *
 * These were unicode glyphs (⟳ ▤ ⚙), which render at whatever weight and
 * baseline the device's font happens to use and never matched each other.
 * Stroked paths at one width, inheriting colour, so they behave like type.
 */
export type IconName =
  | 'refresh'
  | 'standings'
  | 'settings'
  | 'back'
  | 'chevron'
  | 'plus'
  | 'share'
  | 'edit'
  | 'filter'
  | 'order';

const PATHS: Record<IconName, React.ReactNode> = {
  // A circular arrow, open at the top right where the head sits.
  refresh: (
    <>
      <path d="M19 12a7 7 0 1 1-2.05-4.95" />
      <path d="M19 4v4h-4" />
    </>
  ),
  // A podium: first place in the middle and tallest. The three ranked bars
  // this replaces read as a hamburger menu, which is the one thing a
  // standings button must not look like.
  standings: (
    <>
      <path d="M9 20V5h6v15" />
      <path d="M3 20v-9h6" />
      <path d="M15 13h6v7" />
      <path d="M2 20h20" />
    </>
  ),
  // Sliders rather than a gear: far clearer at 20px.
  settings: (
    <>
      <path d="M4 7h9M17 7h3" />
      <path d="M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  chevron: <path d="M9 5l7 7-7 7" />,
  edit: (
    <>
      <path d="M4 20h4l10-10-4-4L4 16v4z" />
      <path d="M14 6l4 4" />
    </>
  ),
  // A funnel: a filter lives behind it.
  filter: <path d="M4 5h16l-6 8v5l-4 2v-7L4 5z" />,
  // Two arrows, up and down: the feed's order lives behind it.
  order: (
    <>
      <path d="M8 4v16" />
      <path d="M4 8l4-4 4 4" />
      <path d="M16 20V4" />
      <path d="M12 16l4 4 4-4" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  share: (
    <>
      <path d="M12 16V4" />
      <path d="M8 8l4-4 4 4" />
      <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.7,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
