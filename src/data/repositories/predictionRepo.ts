import type { SqlDriver } from '../driver';
import type {
  Amendment,
  Category,
  CriteriaElement,
  DeadlineType,
  IntakeNotes,
  Polarity,
  Prediction,
  PredictionStatus,
  PredictionWithContext,
  VerificationMode,
} from '../../domain/types';
import { PREDICTION_COLUMNS, toAmendment, toAuthor, toCriteriaElement, toPrediction, toSqlValue } from '../rows';
import { nowIso, uuid } from '../../lib/ids';
import { areCriteriaEditable, freezeCriteria, type PredictionPatch } from '../../domain/prediction';

export class CriteriaFrozenError extends Error {
  constructor(predictionId: string) {
    super(
      `Criteria for ${predictionId} are frozen. Record an amendment instead of rewriting them.`,
    );
    this.name = 'CriteriaFrozenError';
  }
}

export interface NewPrediction {
  authorId: string;
  rawStatement: string;
  normalizedClaim?: string;
  polarity?: Polarity;
  disconfirmingTrigger?: string | null;
  statementDate: string;
  sourceUrl?: string | null;
  sourceContext?: string | null;

  deadlineType: DeadlineType;
  resolutionDate?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  triggerEvent?: string | null;
  triggerExpectedDate?: string | null;
  raceEventB?: string | null;
  staleOutDate?: string | null;

  verificationMode: VerificationMode;
  forceManual?: boolean;
  searchQueries?: string[];
  noCheckBefore?: string | null;

  category: Category;
  isRetroactive?: boolean;
  stakes?: string | null;
  intakeNotes?: IntakeNotes | null;

  criteria: string[];
  /** Manual entry in v0.1 skips the review card, so it can open immediately. */
  status?: Extract<PredictionStatus, 'draft' | 'open'>;
}

export interface ListFilter {
  status?: PredictionStatus[];
  authorId?: string;
  category?: Category;
  /** miss + lateHitAt set */
  lateHitsOnly?: boolean;
  /** open or draft */
  activeOnly?: boolean;
}

export class PredictionRepo {
  constructor(private db: SqlDriver) {}

  // ---------------------------------------------------------------- reads

  list(filter: ListFilter = {}): Prediction[] {
    const where: string[] = ['p.deleted_at IS NULL'];
    const params: (string | number)[] = [];

    if (filter.status?.length) {
      where.push(`p.status IN (${filter.status.map(() => '?').join(',')})`);
      params.push(...filter.status);
    }
    if (filter.activeOnly) where.push(`p.status IN ('open','draft')`);
    if (filter.authorId) {
      where.push('p.author_id = ?');
      params.push(filter.authorId);
    }
    if (filter.category) {
      where.push('p.category = ?');
      params.push(filter.category);
    }
    if (filter.lateHitsOnly) where.push('p.late_hit_at IS NOT NULL');

    return this.db
      .select(`SELECT p.* FROM predictions p WHERE ${where.join(' AND ')}`, params)
      .map(toPrediction);
  }

  getById(id: string): Prediction | null {
    const rows = this.db.select('SELECT * FROM predictions WHERE id = ?', [id]);
    return rows[0] ? toPrediction(rows[0]) : null;
  }

  getWithContext(id: string): PredictionWithContext | null {
    const prediction = this.getById(id);
    if (!prediction) return null;

    const authorRows = this.db.select('SELECT * FROM authors WHERE id = ?', [prediction.authorId]);
    const authorRow = authorRows[0];
    if (!authorRow) return null;

    const counts = this.db.select<{ n: number }>(
      'SELECT COUNT(*) AS n FROM amendments WHERE prediction_id = ? AND deleted_at IS NULL',
      [id],
    );

    return {
      prediction,
      author: toAuthor(authorRow),
      criteria: this.criteriaFor(id),
      amendmentCount: Number(counts[0]?.n ?? 0),
    };
  }

  criteriaFor(predictionId: string): CriteriaElement[] {
    return this.db
      .select(
        'SELECT * FROM criteria_elements WHERE prediction_id = ? AND deleted_at IS NULL ORDER BY position',
        [predictionId],
      )
      .map(toCriteriaElement);
  }

  amendmentsFor(predictionId: string): Amendment[] {
    return this.db
      .select(
        'SELECT * FROM amendments WHERE prediction_id = ? AND deleted_at IS NULL ORDER BY amended_at DESC',
        [predictionId],
      )
      .map(toAmendment);
  }

  /** Amendment counts for a whole list, so the feed does not fire one query per row. */
  amendmentCounts(): Map<string, number> {
    const rows = this.db.select<{ prediction_id: string; n: number }>(
      'SELECT prediction_id, COUNT(*) AS n FROM amendments WHERE deleted_at IS NULL GROUP BY prediction_id',
    );
    return new Map(rows.map((r) => [String(r.prediction_id), Number(r.n)]));
  }

  // --------------------------------------------------------------- writes

  create(input: NewPrediction): Prediction {
    const now = nowIso();
    const id = uuid();

    const prediction: Prediction = {
      id,
      authorId: input.authorId,
      rawStatement: input.rawStatement.trim(),
      normalizedClaim: (input.normalizedClaim || input.rawStatement).trim(),
      polarity: input.polarity ?? 'positive',
      disconfirmingTrigger: input.disconfirmingTrigger ?? null,
      statementDate: input.statementDate,
      sourceUrl: input.sourceUrl ?? null,
      archiveUrl: null,
      archiveStatus: input.sourceUrl ? 'pending' : 'not_applicable',
      screenshotPath: null,
      sourceContext: input.sourceContext ?? null,
      deadlineType: input.deadlineType,
      resolutionDate: input.resolutionDate ?? null,
      windowStart: input.windowStart ?? null,
      windowEnd: input.windowEnd ?? null,
      triggerEvent: input.triggerEvent ?? null,
      triggerExpectedDate: input.triggerExpectedDate ?? null,
      raceEventB: input.raceEventB ?? null,
      staleOutDate: input.staleOutDate ?? null,
      verificationMode: input.verificationMode,
      forceManual: input.forceManual ?? false,
      searchQueries: input.searchQueries ?? [],
      noCheckBefore: input.noCheckBefore ?? null,
      status: input.status ?? 'open',
      trend: (input.status ?? 'open') === 'open' ? 'unknown' : null,
      confidenceScore: null,
      resolvedAt: null,
      resolvedBy: null,
      lateHitAt: null,
      lateWatchUntil: null,
      category: input.category,
      isRetroactive: input.isRetroactive ?? false,
      stakes: input.stakes ?? null,
      criteriaFrozenAt: null,
      intakeNotes: input.intakeNotes ?? null,
      lastCheckedAt: null,
      checkCount: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    return this.db.transaction(() => {
      const keys = Object.keys(PREDICTION_COLUMNS) as (keyof Prediction)[];
      const columns = keys.map((k) => PREDICTION_COLUMNS[k]);
      const values = keys.map((k) => toSqlValue(k, prediction[k]));

      this.db.run(
        `INSERT INTO predictions (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        values,
      );

      input.criteria
        .map((t) => t.trim())
        .filter(Boolean)
        .forEach((text, index) => this.addCriterion(id, text, index, now));

      return prediction;
    });
  }

  update(id: string, patch: PredictionPatch): void {
    const entries = Object.entries(patch).filter(([k]) => k in PREDICTION_COLUMNS && k !== 'id');
    if (entries.length === 0) return;

    const assignments = entries
      .map(([k]) => `${PREDICTION_COLUMNS[k as keyof Prediction]} = ?`)
      .join(', ');
    const values = entries.map(([k, v]) => toSqlValue(k as keyof Prediction, v));

    this.db.run(`UPDATE predictions SET ${assignments} WHERE id = ?`, [...values, id]);
  }

  addCriterion(predictionId: string, text: string, position: number, at = nowIso()): CriteriaElement {
    const element: CriteriaElement = {
      id: uuid(),
      predictionId,
      position,
      text: text.trim(),
      satisfied: null,
      satisfiedAt: null,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
    this.db.run(
      `INSERT INTO criteria_elements (id, prediction_id, position, text, satisfied, satisfied_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, NULL)`,
      [element.id, predictionId, position, element.text, at, at],
    );
    return element;
  }

  setCriterionSatisfied(id: string, satisfied: boolean | null): void {
    const now = nowIso();
    this.db.run(
      'UPDATE criteria_elements SET satisfied = ?, satisfied_at = ?, updated_at = ? WHERE id = ?',
      [satisfied === null ? null : satisfied ? 1 : 0, satisfied ? now : null, now, id],
    );
  }

  /**
   * Replace the criteria list wholesale. Only legal before the criteria freeze;
   * callers past the freeze must go through `amend` so the change is on record.
   */
  replaceCriteria(predictionId: string, texts: string[]): void {
    const current = this.getById(predictionId);
    if (!current) throw new Error(`No prediction ${predictionId}`);
    if (!areCriteriaEditable(current)) {
      throw new CriteriaFrozenError(predictionId);
    }
    const now = nowIso();
    this.db.transaction(() => {
      this.db.run('UPDATE criteria_elements SET deleted_at = ? WHERE prediction_id = ?', [
        now,
        predictionId,
      ]);
      texts
        .map((t) => t.trim())
        .filter(Boolean)
        .forEach((text, index) => this.addCriterion(predictionId, text, index, now));
      this.db.run('UPDATE predictions SET updated_at = ? WHERE id = ?', [now, predictionId]);
    });
  }

  /**
   * Change a frozen field and leave a visible record of it. Editing is allowed;
   * hiding the edit is not.
   */
  amend(
    predictionId: string,
    field: keyof Prediction,
    newValue: string,
    reason: string,
  ): Amendment {
    const current = this.getById(predictionId);
    if (!current) throw new Error(`No prediction ${predictionId}`);
    if (!reason.trim()) throw new Error('An amendment needs a reason');

    const now = nowIso();
    const amendment: Amendment = {
      id: uuid(),
      predictionId,
      field: String(field),
      oldValue: String(current[field] ?? ''),
      newValue,
      reason: reason.trim(),
      amendedAt: now,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    return this.db.transaction(() => {
      this.db.run(
        `INSERT INTO amendments (id, prediction_id, field, old_value, new_value, reason, amended_at, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          amendment.id,
          predictionId,
          amendment.field,
          amendment.oldValue,
          amendment.newValue,
          amendment.reason,
          now,
          now,
          now,
        ],
      );
      this.update(predictionId, { [field]: newValue, updatedAt: now } as PredictionPatch);
      return amendment;
    });
  }

  /**
   * Rewrite a draft in place from a fresh set of intake values. Only drafts:
   * an open prediction's fields move through `amend` so the change is visible.
   */
  updateDraft(id: string, input: NewPrediction): void {
    const current = this.getById(id);
    if (!current) throw new Error(`No prediction ${id}`);
    if (current.status !== 'draft') {
      throw new Error('Only a draft can be rewritten wholesale.');
    }

    this.db.transaction(() => {
      this.update(id, {
        authorId: input.authorId,
        rawStatement: input.rawStatement.trim(),
        normalizedClaim: (input.normalizedClaim || input.rawStatement).trim(),
        polarity: input.polarity ?? 'positive',
        disconfirmingTrigger: input.disconfirmingTrigger ?? null,
        statementDate: input.statementDate,
        sourceUrl: input.sourceUrl ?? null,
        sourceContext: input.sourceContext ?? null,
        deadlineType: input.deadlineType,
        resolutionDate: input.resolutionDate ?? null,
        windowStart: input.windowStart ?? null,
        windowEnd: input.windowEnd ?? null,
        triggerEvent: input.triggerEvent ?? null,
        triggerExpectedDate: input.triggerExpectedDate ?? null,
        raceEventB: input.raceEventB ?? null,
        staleOutDate: input.staleOutDate ?? null,
        verificationMode: input.verificationMode,
        forceManual: input.forceManual ?? false,
        searchQueries: input.searchQueries ?? [],
        noCheckBefore: input.noCheckBefore ?? null,
        category: input.category,
        isRetroactive: input.isRetroactive ?? false,
        stakes: input.stakes ?? null,
        ...(input.intakeNotes !== undefined ? { intakeNotes: input.intakeNotes } : {}),
        updatedAt: nowIso(),
      });
      this.replaceCriteria(id, input.criteria);
    });
  }

  /** Called by the first verification check. Idempotent. */
  freeze(predictionId: string): void {
    const current = this.getById(predictionId);
    if (!current) throw new Error(`No prediction ${predictionId}`);
    const patch = freezeCriteria(current);
    if (patch) this.update(predictionId, patch);
  }

  softDelete(id: string): void {
    const now = nowIso();
    this.db.run('UPDATE predictions SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
  }
}
