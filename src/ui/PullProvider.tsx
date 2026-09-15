import { createContext, useContext, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useDb } from './DbProvider';
import { createVerifier } from '../verification/registry';
import { runPull, type PullProgress, type PullSummary } from '../verification/runPull';
import { BrowserPageFetcher, type PageFetcher } from '../verification/validateSources';
import { CapacitorPageFetcher } from '../platform/CapacitorPageFetcher';
import { isNative } from '../platform';
import { loadVerifierConfig } from '../lib/keyStore';
import { DEFAULT_PULL_BUDGET } from '../domain/cadence';

export type PullArgs = { onlyPredictionId?: string } | void;

export type PullHandle = UseMutationResult<PullSummary, Error, PullArgs> & {
  /** How far through the pull is, while one runs. */
  progress: PullProgress | null;
};

const PullContext = createContext<PullHandle | null>(null);

function pageFetcher(): PageFetcher {
  // The browser fetcher cannot tell a dead URL from a cross-origin refusal, so
  // nothing auto-resolves on the web build. The native one goes through native
  // code, sees real status codes, and the gates start biting.
  return isNative() ? new CapacitorPageFetcher() : new BrowserPageFetcher();
}

/**
 * The one pull in the app, held above the router.
 *
 * It used to be a hook each screen called for itself. The pull kept running
 * when the feed unmounted (a mutation outlives its component), but everything
 * that showed it was local to that screen: open a bet mid-pull and the detail
 * screen knew nothing about it, come back and the feed had a fresh, idle hook
 * with no spinner and no summary. To the owner that looked like leaving the
 * feed had killed the pull. Now every screen reads the same running state,
 * and each finished check refreshes the queries so the log fills in live
 * rather than all at once at the end.
 *
 * Still the only thing that spends quota, and still started only by a tap.
 */
export function PullProvider({ children }: { children: ReactNode }) {
  const db = useDb();
  const client = useQueryClient();

  // Checks are spaced to stay under a per-minute cap, so a full pull runs for
  // most of a minute. This is what turns that into "3 of 6" instead of a word
  // that could equally mean the thing has hung.
  const [progress, setProgress] = useState<PullProgress | null>(null);

  const mutation = useMutation<PullSummary, Error, PullArgs>({
    mutationFn: async (args) => {
      const config = loadVerifierConfig();
      return runPull(
        db,
        { verifier: createVerifier(config), fetcher: pageFetcher() },
        {
          budget: DEFAULT_PULL_BUDGET,
          dailyQuota: config.dailyQuota,
          onProgress: (next) => {
            setProgress(next);
            // A check has just been written, so whatever screen is showing
            // should reflect it now rather than when the whole pull ends.
            if (next.done > 0) void client.invalidateQueries();
          },
          ...(args?.onlyPredictionId
            ? { onlyPredictionId: args.onlyPredictionId, trigger: 'force' as const }
            : {}),
        },
      );
    },
    onSettled: () => {
      setProgress(null);
      void client.invalidateQueries();
    },
  });

  return <PullContext.Provider value={{ ...mutation, progress }}>{children}</PullContext.Provider>;
}

/** The running pull, from any screen. */
export function usePull(): PullHandle {
  const handle = useContext(PullContext);
  if (!handle) throw new Error('usePull needs a PullProvider above it');
  return handle;
}
