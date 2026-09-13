import type { SqlDriver } from '../driver';
import type { Check, CheckOutcome, CheckTrigger, Evidence, PredictionStatus, SourceTier, Trend } from '../../domain/types';
import type { FetchStatus } from '../../domain/types';
import { toCheck, toEvidence } from '../rows';
import { nowIso, uuid } from '../../lib/ids';

export interface NewEvidence {
  url: string;
  title: string | null;
  publisher: string | null;
  publishedAt: string | null;
  quotedText: string | null;
  tier: SourceTier | null;
  fetchStatus: FetchStatus;
  fetchedAt: string | null;
}

export interface NewCheck {
  predictionId: string;
  trigger: CheckTrigger;
  provider: string;
  model: string | null;
  proposedVerdict: PredictionStatus | 'no_change' | null;
  proposedTrend: Trend | null;
  gates?: string[] | null;
  modelConfidence: number | null;
  summary: string;
  outcome: CheckOutcome;
  errorMessage?: string | null;
  tokensUsed?: number | null;
  searchQueries?: string[] | null;
  evidence?: NewEvidence[];
}

export class CheckRepo {
  constructor(private db: SqlDriver) {}

  /**
   * Newest first. Ordered by rowid as well as timestamp: two checks written in
   * the same millisecond are common inside one pull, and ordering by the
   * timestamp alone puts them in an arbitrary order.
   */
  listFor(predictionId: string): Check[] {
    return this.db
      .select(
        `SELECT * FROM checks
         WHERE prediction_id = ? AND deleted_at IS NULL
         ORDER BY ran_at DESC, rowid DESC`,
        [predictionId],
      )
      .map(toCheck);
  }

  evidenceFor(checkId: string): Evidence[] {
    return this.db
      .select('SELECT * FROM evidence WHERE check_id = ? AND deleted_at IS NULL ORDER BY rowid', [
        checkId,
      ])
      .map(toEvidence);
  }

  /** Evidence for a whole check log in one query rather than one per check. */
  evidenceByCheck(predictionId: string): Map<string, Evidence[]> {
    const rows = this.db.select(
      `SELECT e.* FROM evidence e
       JOIN checks c ON c.id = e.check_id
       WHERE c.prediction_id = ? AND e.deleted_at IS NULL
       ORDER BY e.rowid`,
      [predictionId],
    );
    const byCheck = new Map<string, Evidence[]>();
    for (const row of rows) {
      const evidence = toEvidence(row);
      const list = byCheck.get(evidence.checkId) ?? [];
      list.push(evidence);
      byCheck.set(evidence.checkId, list);
    }
    return byCheck;
  }

  /** The most recent check that actually found something, for the detail header. */
  latestFor(predictionId: string): Check | null {
    return this.listFor(predictionId)[0] ?? null;
  }

  /** A short digest of recent findings, handed back to the model for continuity. */
  priorFindings(predictionId: string, limit = 2): string | null {
    const recent = this.listFor(predictionId)
      .filter((c) => c.outcome !== 'error')
      .slice(0, limit);
    if (recent.length === 0) return null;
    return recent
      .map((c) => `${c.ranAt.slice(0, 10)}: ${c.summary}`)
      .join('\n');
  }

  create(input: NewCheck): Check {
    const now = nowIso();
    const id = uuid();

    return this.db.transaction(() => {
      this.db.run(
        `INSERT INTO checks (
           id, prediction_id, ran_at, trigger, provider, model,
           proposed_verdict, proposed_trend, gates,
           model_confidence, summary, outcome, error_message, tokens_used,
           search_queries, created_at, updated_at, deleted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          id,
          input.predictionId,
          now,
          input.trigger,
          input.provider,
          input.model,
          input.proposedVerdict,
          input.proposedTrend,
          input.gates?.length ? JSON.stringify(input.gates) : null,
          input.modelConfidence,
          input.summary,
          input.outcome,
          input.errorMessage ?? null,
          input.tokensUsed ?? null,
          input.searchQueries?.length ? JSON.stringify(input.searchQueries) : null,
          now,
          now,
        ],
      );

      for (const evidence of input.evidence ?? []) {
        this.db.run(
          `INSERT INTO evidence (
             id, check_id, url, title, publisher, published_at, quoted_text,
             tier, fetch_status, fetched_at, created_at, updated_at, deleted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [
            uuid(),
            id,
            evidence.url,
            evidence.title,
            evidence.publisher,
            evidence.publishedAt,
            evidence.quotedText,
            evidence.tier,
            evidence.fetchStatus,
            evidence.fetchedAt,
            now,
            now,
          ],
        );
      }

      return toCheck(
        this.db.select('SELECT * FROM checks WHERE id = ?', [id])[0]!,
      );
    });
  }

  /**
   * Predictions whose most recent check proposed a verdict awaiting approval.
   *
   * Matching on the newest rowid rather than the newest timestamp, because
   * `MAX(ran_at)` ties when two checks land in the same millisecond, which
   * would leave a superseded proposal still showing as waiting on the user.
   */
  queuedVerdicts(): Map<string, Check> {
    const rows = this.db.select(
      `SELECT c.* FROM checks c
       WHERE c.outcome = 'queued' AND c.deleted_at IS NULL
         AND c.rowid = (
           SELECT c2.rowid FROM checks c2
           WHERE c2.prediction_id = c.prediction_id AND c2.deleted_at IS NULL
           ORDER BY c2.ran_at DESC, c2.rowid DESC
           LIMIT 1
         )`,
    );
    return new Map(
      rows.map((row) => {
        const check = toCheck(row);
        return [check.predictionId, check];
      }),
    );
  }

  /** Clear a queued proposal once the user has acted on it. */
  markActedOn(checkId: string, outcome: CheckOutcome): void {
    this.db.run('UPDATE checks SET outcome = ?, updated_at = ? WHERE id = ?', [
      outcome,
      nowIso(),
      checkId,
    ]);
  }
}

export class QuotaRepo {
  constructor(private db: SqlDriver) {}

  private static day(at = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  }

  usedToday(provider: string, at = new Date()): number {
    const rows = this.db.select<{ calls: number }>(
      'SELECT calls FROM quota_log WHERE provider = ? AND day = ?',
      [provider, QuotaRepo.day(at)],
    );
    return Number(rows[0]?.calls ?? 0);
  }

  /**
   * Calls so far this calendar month, for comparing against a provider's
   * billing page. The daily number answers "can I check again now"; this one
   * answers "am I spending more than I meant to", which is a different
   * question and the one that costs money.
   */
  usedThisMonth(provider: string, at = new Date()): number {
    const prefix = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-`;
    const rows = this.db.select<{ calls: number }>(
      'SELECT COALESCE(SUM(calls), 0) AS calls FROM quota_log WHERE provider = ? AND day LIKE ?',
      [provider, `${prefix}%`],
    );
    return Number(rows[0]?.calls ?? 0);
  }

  /*
   * Seeded sample checks carry `provider: 'demo'` and are excluded from both
   * totals below. Settings read "2 searches run this month" on a fresh
   * install with zero real checks, because the Dodgers sample carries two.
   */

  /**
   * Searches run this calendar month, which is what a grounded check is
   * actually billed in: Gemini charges per search query, not per prompt, so a
   * month of twenty checks can cost anywhere from twenty to two hundred and
   * forty searches depending on whether the model respected the prompt's
   * ceiling. The call count cannot show that and this can.
   *
   * Bounded by instants rather than by a date-string prefix. `day` in
   * quota_log is written locally and `ran_at` is a UTC instant, and comparing
   * a local month prefix against an instant is the bug that has already
   * shipped twice in this codebase.
   */
  searchesThisMonth(at = new Date()): number {
    const start = new Date(at.getFullYear(), at.getMonth(), 1).toISOString();
    const end = new Date(at.getFullYear(), at.getMonth() + 1, 1).toISOString();
    const rows = this.db.select<{ search_queries: string }>(
      `SELECT search_queries FROM checks
        WHERE deleted_at IS NULL AND search_queries IS NOT NULL
          AND provider <> 'demo'
          AND ran_at >= ? AND ran_at < ?`,
      [start, end],
    );

    let total = 0;
    for (const row of rows) {
      try {
        const parsed: unknown = JSON.parse(String(row.search_queries));
        if (Array.isArray(parsed)) total += parsed.length;
      } catch {
        // A malformed row is not worth failing a settings screen over.
      }
    }
    return total;
  }

  /**
   * Tokens the provider reported, summed over checks. This is the one cost
   * figure the app can state exactly: every check stores usageMetadata's
   * total. It is not a bill. The provider prices input and output tokens
   * differently and reports only the sum here, and it says nothing about
   * search queries, which are billed separately. Intake calls are not
   * counted either; their token count is not stored.
   */
  tokensUsed(at = new Date()): { allTime: number; thisMonth: number } {
    const start = new Date(at.getFullYear(), at.getMonth(), 1).toISOString();
    const end = new Date(at.getFullYear(), at.getMonth() + 1, 1).toISOString();
    const rows = this.db.select<{ all_time: number; this_month: number }>(
      `SELECT COALESCE(SUM(tokens_used), 0) AS all_time,
              COALESCE(SUM(CASE WHEN ran_at >= ? AND ran_at < ? THEN tokens_used ELSE 0 END), 0) AS this_month
         FROM checks
        WHERE deleted_at IS NULL AND tokens_used IS NOT NULL AND provider <> 'demo'`,
      [start, end],
    );
    return { allTime: Number(rows[0]?.all_time ?? 0), thisMonth: Number(rows[0]?.this_month ?? 0) };
  }

  record(provider: string, calls = 1, at = new Date()): void {
    this.db.run(
      `INSERT INTO quota_log (id, provider, day, calls) VALUES (?, ?, ?, ?)
       ON CONFLICT(provider, day) DO UPDATE SET calls = calls + excluded.calls`,
      [uuid(), provider, QuotaRepo.day(at), calls],
    );
  }
}
