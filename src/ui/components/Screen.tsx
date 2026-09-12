import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

/** Shared page frame: fixed header, scrolling body, safe-area padding. */
export function Screen({
  title,
  subtitle,
  back,
  actions,
  scroll = true,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: boolean;
  actions?: ReactNode;
  /** Set false when the child owns scrolling, so the two do not nest. */
  scroll?: boolean;
  children: ReactNode;
}) {
  const navigate = useNavigate();

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <header className="sticky top-0 z-10 border-b border-rule bg-ground/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-center gap-3">
          {back && (
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="Back"
              className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-dim active:bg-surface-raised"
            >
              <Icon name="back" size={22} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-xl leading-tight">{title}</h1>
            {subtitle && <p className="mt-0.5 text-[13px] text-ink-faint">{subtitle}</p>}
          </div>
          {actions}
        </div>
      </header>
      <main
        className={
          scroll
            ? 'flex-1 overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]'
            : 'min-h-0 flex-1'
        }
      >
        {children}
      </main>
    </div>
  );
}

export function HeaderLink({ to, label, icon }: { to: string; label: string; icon: IconName }) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-dim active:bg-surface-raised"
    >
      <Icon name={icon} />
    </Link>
  );
}
