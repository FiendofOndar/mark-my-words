/**
 * Row mapping. SQLite speaks snake_case, 0/1 booleans and JSON strings;
 * the domain speaks camelCase, real booleans and arrays. The translation
 * lives here and nowhere else.
 */
import type {
  Amendment,
  Author,
  AuthorKind,
  ArchiveStatus,
  Category,
  Check,
  CheckOutcome,
  CheckTrigger,
  CriteriaElement,
  DeadlineType,
  Evidence,
  FetchStatus,
  IntakeNotes,
  Polarity,
  Prediction,
  PredictionStatus,
  ResolvedBy,
  SourceTier,
  Trend,
  VerificationMode,
} from '../domain/types';
import type { SqlValue } from './driver';

type Row = Record<string, SqlValue>;

// Row lookups are `SqlValue | undefined` under noUncheckedIndexedAccess, and a
// column missing from a SELECT is indistinguishable from NULL here, so every
// reader tolerates both.
type Cell = SqlValue | undefined;

const str = (v: Cell): string => (v == null ? '' : String(v));
const nstr = (v: Cell): string | null => (v == null ? null : String(v));
const num = (v: Cell): number => (v == null ? 0 : Number(v));
const nnum = (v: Cell): number | null => (v == null ? null : Number(v));
const bool = (v: Cell): boolean => Number(v) === 1;
const bit = (v: boolean): number => (v ? 1 : 0);

function intakeNotes(v: Cell): IntakeNotes | null {
  if (v == null) return null;
  try {
    const parsed = JSON.parse(String(v));
    return typeof parsed === 'object' && parsed !== null ? (parsed as IntakeNotes) : null;
  } catch {
    return null;
  }
}

function jsonArray(v: Cell): string[] {
  if (v == null) return [];
  try {
    const parsed = JSON.parse(String(v));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function toAuthor(r: Row): Author {
  return {
    id: str(r.id),
    displayName: str(r.display_name),
    handle: nstr(r.handle),
    kind: str(r.kind) as AuthorKind,
    avatarPath: nstr(r.avatar_path),
    notes: nstr(r.notes),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    deletedAt: nstr(r.deleted_at),
  };
}

export function toPrediction(r: Row): Prediction {
  return {
    id: str(r.id),
    authorId: str(r.author_id),

    rawStatement: str(r.raw_statement),
    normalizedClaim: str(r.normalized_claim),
    polarity: str(r.polarity) as Polarity,
    disconfirmingTrigger: nstr(r.disconfirming_trigger),

    statementDate: str(r.statement_date),
    sourceUrl: nstr(r.source_url),
    archiveUrl: nstr(r.archive_url),
    archiveStatus: str(r.archive_status) as ArchiveStatus,
    archiveAttempts: num(r.archive_attempts),
    screenshotPath: nstr(r.screenshot_path),
    sourceContext: nstr(r.source_context),

    deadlineType: str(r.deadline_type) as DeadlineType,
    resolutionDate: nstr(r.resolution_date),
    windowStart: nstr(r.window_start),
    windowEnd: nstr(r.window_end),
    triggerEvent: nstr(r.trigger_event),
    triggerExpectedDate: nstr(r.trigger_expected_date),
    raceEventB: nstr(r.race_event_b),
    staleOutDate: nstr(r.stale_out_date),

    verificationMode: str(r.verification_mode) as VerificationMode,
    forceManual: bool(r.force_manual),
    searchQueries: jsonArray(r.search_queries),
    noCheckBefore: nstr(r.no_check_before),

    status: str(r.status) as PredictionStatus,
    trend: (nstr(r.trend) as Trend | null) ?? null,
    resolvedAt: nstr(r.resolved_at),
    resolvedBy: (nstr(r.resolved_by) as ResolvedBy | null) ?? null,
    lateHitAt: nstr(r.late_hit_at),
    lateWatchUntil: nstr(r.late_watch_until),

    category: str(r.category) as Category,
    isRetroactive: bool(r.is_retroactive),
    stakes: nstr(r.stakes),
    criteriaFrozenAt: nstr(r.criteria_frozen_at),
    intakeNotes: intakeNotes(r.intake_notes),
    promptSnoozes: num(r.prompt_snoozes),
    promptNextAt: nstr(r.prompt_next_at),
    lastCheckedAt: nstr(r.last_checked_at),
    checkCount: num(r.check_count),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    deletedAt: nstr(r.deleted_at),
  };
}

export function toCriteriaElement(r: Row): CriteriaElement {
  return {
    id: str(r.id),
    predictionId: str(r.prediction_id),
    position: num(r.position),
    text: str(r.text),
    satisfied: r.satisfied == null ? null : bool(r.satisfied),
    satisfiedAt: nstr(r.satisfied_at),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    deletedAt: nstr(r.deleted_at),
  };
}

export function toAmendment(r: Row): Amendment {
  return {
    id: str(r.id),
    predictionId: str(r.prediction_id),
    field: str(r.field),
    oldValue: str(r.old_value),
    newValue: str(r.new_value),
    reason: str(r.reason),
    amendedAt: str(r.amended_at),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    deletedAt: nstr(r.deleted_at),
  };
}

export function toCheck(r: Row): Check {
  return {
    id: str(r.id),
    predictionId: str(r.prediction_id),
    ranAt: str(r.ran_at),
    trigger: str(r.trigger) as CheckTrigger,
    provider: str(r.provider),
    model: nstr(r.model),
    proposedVerdict: (nstr(r.proposed_verdict) as Check['proposedVerdict']) ?? null,
    proposedTrend: (nstr(r.proposed_trend) as Trend | null) ?? null,
    gates: parseGates(nstr(r.gates)),
    modelConfidence: nnum(r.model_confidence),
    summary: str(r.summary),
    outcome: str(r.outcome) as CheckOutcome,
    errorMessage: nstr(r.error_message),
    tokensUsed: nnum(r.tokens_used),
    searchQueries: parseStringList(nstr(r.search_queries)),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    deletedAt: nstr(r.deleted_at),
  };
}

export function toEvidence(r: Row): Evidence {
  return {
    id: str(r.id),
    checkId: str(r.check_id),
    url: str(r.url),
    title: nstr(r.title),
    publisher: nstr(r.publisher),
    publishedAt: nstr(r.published_at),
    quotedText: nstr(r.quoted_text),
    tier: (nstr(r.tier) as SourceTier | null) ?? null,
    fetchStatus: str(r.fetch_status) as FetchStatus,
    fetchedAt: nstr(r.fetched_at),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    deletedAt: nstr(r.deleted_at),
  };
}

/** Domain field -> column name, used to build UPDATE statements from a patch. */
export const PREDICTION_COLUMNS: Record<keyof Prediction, string> = {
  id: 'id',
  authorId: 'author_id',
  rawStatement: 'raw_statement',
  normalizedClaim: 'normalized_claim',
  polarity: 'polarity',
  disconfirmingTrigger: 'disconfirming_trigger',
  statementDate: 'statement_date',
  sourceUrl: 'source_url',
  archiveUrl: 'archive_url',
  archiveStatus: 'archive_status',
  archiveAttempts: 'archive_attempts',
  screenshotPath: 'screenshot_path',
  sourceContext: 'source_context',
  deadlineType: 'deadline_type',
  resolutionDate: 'resolution_date',
  windowStart: 'window_start',
  windowEnd: 'window_end',
  triggerEvent: 'trigger_event',
  triggerExpectedDate: 'trigger_expected_date',
  raceEventB: 'race_event_b',
  staleOutDate: 'stale_out_date',
  verificationMode: 'verification_mode',
  forceManual: 'force_manual',
  searchQueries: 'search_queries',
  noCheckBefore: 'no_check_before',
  status: 'status',
  trend: 'trend',
  resolvedAt: 'resolved_at',
  resolvedBy: 'resolved_by',
  lateHitAt: 'late_hit_at',
  lateWatchUntil: 'late_watch_until',
  category: 'category',
  isRetroactive: 'is_retroactive',
  stakes: 'stakes',
  criteriaFrozenAt: 'criteria_frozen_at',
  intakeNotes: 'intake_notes',
  promptSnoozes: 'prompt_snoozes',
  promptNextAt: 'prompt_next_at',
  lastCheckedAt: 'last_checked_at',
  checkCount: 'check_count',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  deletedAt: 'deleted_at',
};

/** Coerce a domain value into something SQLite will accept. */
export function toSqlValue(key: keyof Prediction, value: unknown): SqlValue {
  if (value === undefined || value === null) return null;
  if (key === 'searchQueries' || key === 'intakeNotes') return JSON.stringify(value);
  if (typeof value === 'boolean') return bit(value);
  if (typeof value === 'number') return value;
  return String(value);
}

/**
 * A JSON array of strings, or nothing. A column written before this existed,
 * or by a provider that does not report searches, reads as null rather than as
 * an empty list: "we were not told" and "it ran none" are different facts.
 */
function parseStringList(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return null;
  }
}

/**
 * Gates are stored as a JSON array. Rows written before the score was removed
 * hold the old breakdown object with the gates inside it, so both shapes read.
 */
function parseGates(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { gates?: unknown }).gates)
        ? (parsed as { gates: unknown[] }).gates
        : [];
    return list.filter((g): g is string => typeof g === 'string');
  } catch {
    return [];
  }
}
