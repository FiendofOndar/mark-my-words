import type { ReactNode } from 'react';
import { openExternal } from '../../platform';

/**
 * A link that leaves the app. Still an anchor with a real href, so it can be
 * long-pressed and copied and reads as a link to assistive tech; the tap
 * itself goes through the platform so the page opens in the right place.
 */
export function ExternalLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={className}
      onClick={(event) => {
        event.preventDefault();
        void openExternal(href);
      }}
    >
      {children}
    </a>
  );
}
