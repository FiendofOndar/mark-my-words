import { useEffect, useState } from 'react';
import { loadScreenshot } from '../../platform/sharedImage';

/**
 * The screenshot a prediction was captured from, when there is one. For an
 * Instagram or X post it is the only copy of the source that will survive,
 * so it sits with the source links rather than behind a tap.
 */
export function SourceScreenshot({ path }: { path: string | null }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!path) {
      setSrc(null);
      return;
    }
    void loadScreenshot(path).then((url) => {
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [path]);

  if (!src) return null;
  return (
    <img
      src={src}
      alt="Screenshot of the source"
      className="mt-3 max-h-72 w-auto max-w-full rounded-lg border border-rule"
    />
  );
}
