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
  rubricScore: number | null;
  rubricBreakdown: unknown;
  modelConfidence: number | null;
  summary: string;
  outcome: CheckOutcome;
  errorMessage?: string | null;
  tokensUsed?: number | null;
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
           proposed_verdict, proposed_trend, rubric_score, rubric_breakdown,
           model_confidence, summary, outcome, error_message, tokens_used,
           created_at, updated_at, deleted_at
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
          input.rubricScore,
          input.rubricBreakdown === undefined || input.rubricBreakdown === null
            ? null
            : JSON.stringify(input.rubricBreakdown),
          input.modelConfidence,
          input.summary,
          input.outcome,
          input.errorMessage ?? null,
          input.tokensUsed ?? null,
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

  record(provider: string, calls = 1, at = new Date()): void {
    this.db.run(
      `INSERT INTO quota_log (id, provider, day, calls) VALUES (?, ?, ?, ?)
       ON CONFLICT(provider, day) DO UPDATE SET calls = calls + excluded.calls`,
      [uuid(), provider, QuotaRepo.day(at), calls],
    );
  }
}
