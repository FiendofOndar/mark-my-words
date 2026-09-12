import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDb } from '../ui/DbProvider';
import { archiveSource, MAX_ARCHIVE_ATTEMPTS } from './archive';
import { archiveHttp } from './http';

/**
 * Retry archiving on app open.
 *
 * Archiving fails often, so one attempt at capture time is not a strategy.
 * Attempts are counted and capped, because a source that has refused three
 * times is not going to start cooperating, and the app should stop pretending
 * otherwise and ask for a screenshot instead.
 */
export function useArchiveQueue() {
  const db = useDb();
  const client = useQueryClient();
  const running = useRef(false);

  useEffect(() => {
    if (running.current) return;
    running.current = true;

    void (async () => {
      try {
        const pending = db.predictions.awaitingArchive(MAX_ARCHIVE_ATTEMPTS);
        if (pending.length === 0) return;

        let changed = false;
        for (const prediction of pending) {
          if (!prediction.sourceUrl) continue;
          const outcome = await archiveSource(prediction.sourceUrl, archiveHttp);
          // Still pending means try again next time, so leave it alone apart
          // from the attempt count.
          db.predictions.recordArchiveAttempt(prediction.id, outcome);
          changed = true;
        }

        if (changed) {
          await db.driver.persist();
          void client.invalidateQueries();
        }
      } finally {
        running.current = false;
      }
    })();
  }, [db, client]);
}
