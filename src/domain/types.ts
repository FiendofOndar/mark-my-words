/**
 * Core domain types. Pure data, no I/O, no framework.
 * Every timestamp is an ISO-8601 UTC string. Every id is a UUIDv4 string.
 */

export type Iso = string;
export type Uuid = string;

export type PredictionStatus =
  | 'draft'
  | 'open'
  | 'hit'
  | 'miss'
  | 'partial'
  | 'ambiguous'
  | 'void';

export type Trend = 'toward_yes' | 'toward_no' | 'flat' | 'unknown';

export type Polarity = 'positive' | 'negative';

export type DeadlineType = 'fixed_date' | 'window' | 'event';

export type VerificationMode = 'searchable' | 'manual';

export type ResolvedBy = 'auto' | 'user' | 'user_override';

export type AuthorKind = 'person' | 'outlet' | 'self';

/** Closed taxonomy. Freeform tags cover everything this misses. */
export const CATEGORIES = [
  'Sports',
  'Tech/AI',
  'Politics',
  'Economics',
  'Weather/Climate',
  'Entertainment',
  'Personal',
  'Other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export type ArchiveStatus = 'pending' | 'ok' | 'failed' | 'not_applicable';

export interface Author {
  id: Uuid;
  displayName: string;
  handle: string | null;
  kind: AuthorKind;
  avatarPath: string | null;
  notes: string | null;
  createdAt: Iso;
  updatedAt: Iso;
  deletedAt: Iso | null;
}

export interface CriteriaElement {
  id: Uuid;
  predictionId: Uuid;
  position: number;
  text: string;
  /** null = not yet known */
  satisfied: boolean | null;
  satisfiedAt: Iso | null;
  createdAt: Iso;
  updatedAt: Iso;
  deletedAt: Iso | null;
}

/**
 * What the intake pass said while drafting the record. Kept alongside the
 * prediction so the review card survives a reload, and so a resolved record
 * still shows why its deadline is the date it is.
 */
export interface IntakeNotes {
  deadlineReasoning: string;
  verifiabilityReasoning: string;
  /** Questions the user must settle before the clock starts. */
  ambiguities: string[];
  /** Fields the app had to repair in the model's response. */
  warnings: string[];
  provider: string;
  model: string;
  draftedAt: Iso;
}

export interface Prediction {
  id: Uuid;
  authorId: Uuid;

  // the claim
  rawStatement: string;
  normalizedClaim: string;
  polarity: Polarity;
  /** required when polarity is 'negative': the event that, if found, kills the claim */
  disconfirmingTrigger: string | null;

  // provenance
  statementDate: Iso;
  sourceUrl: string | null;
  archiveUrl: string | null;
  archiveStatus: ArchiveStatus;
  archiveAttempts: number;
  screenshotPath: string | null;
  sourceContext: string | null;

  // deadline
  deadlineType: DeadlineType;
  resolutionDate: Iso | null;
  windowStart: Iso | null;
  windowEnd: Iso | null;
  triggerEvent: string | null;
  triggerExpectedDate: Iso | null;
  raceEventB: string | null;
  staleOutDate: Iso | null;

  // verification config
  verificationMode: VerificationMode;
  forceManual: boolean;
  searchQueries: string[];
  noCheckBefore: Iso | null;
  /**
   * Whether the claim could still come true after its deadline. "Bitcoin
   * above $100k by the end of 2024" can happen in 2025 and earn the late
   * badge; "85F in Anacortes on September 12" cannot happen on any other day.
   * The deadline type does not tell these apart: both are fixed dates. The
   * intake model sets it, the review card can flip it, and both late watch and
   * the "it happened anyway" control read it.
   */
  canHappenLate: boolean;

  // state
  status: PredictionStatus;
  trend: Trend | null;
  resolvedAt: Iso | null;
  resolvedBy: ResolvedBy | null;
  lateHitAt: Iso | null;
  lateWatchUntil: Iso | null;

  // bookkeeping
  category: Category;
  isRetroactive: boolean;
  stakes: string | null;
  criteriaFrozenAt: Iso | null;
  intakeNotes: IntakeNotes | null;
  /** How many times the deadline prompt for a manual prediction has been put off. */
  promptSnoozes: number;
  /** When to ask again, once the first prompt has been snoozed. */
  promptNextAt: Iso | null;
  lastCheckedAt: Iso | null;
  checkCount: number;
  createdAt: Iso;
  updatedAt: Iso;
  deletedAt: Iso | null;
}

/** A prediction joined with the things the UI always needs alongside it. */
export interface PredictionWithContext {
  prediction: Prediction;
  author: Author;
  criteria: CriteriaElement[];
  amendmentCount: number;
}

export interface Amendment {
  id: Uuid;
  predictionId: Uuid;
  field: string;
  oldValue: string;
  newValue: string;
  reason: string;
  amendedAt: Iso;
  createdAt: Iso;
  updatedAt: Iso;
  deletedAt: Iso | null;
}

export type CheckTrigger = 'pull' | 'force' | 'deadline' | 'backfill';
export type CheckOutcome = 'auto_resolved' | 'queued' | 'no_change' | 'error';

export interface Check {
  id: Uuid;
  predictionId: Uuid;
  ranAt: Iso;
  trigger: CheckTrigger;
  provider: string;
  model: string | null;
  proposedVerdict: PredictionStatus | 'no_change' | null;
  proposedTrend: Trend | null;
  /** What the app noticed about the citations that kept it from acting alone. */
  gates: string[];
  modelConfidence: number | null;
  summary: string;
  outcome: CheckOutcome;
  errorMessage: string | null;
  tokensUsed: number | null;
  /** The searches the provider ran, when it reported them. */
  searchQueries: string[] | null;
  createdAt: Iso;
  updatedAt: Iso;
  deletedAt: Iso | null;
}

export type SourceTier = 'primary' | 'major_outlet' | 'secondary' | 'social';
/**
 * What the app learned by opening a cited link itself: whether it goes
 * anywhere. `ok` means the page answered, `blocked` means the host answered
 * but refused the app (a bot wall, a paywall, a timeout), `unreachable` means
 * there is no page there. Only the last is evidence of an invented citation.
 *
 * There used to be two more, for a page that loaded but did not carry the
 * quoted sentence, or carried its figures without its wording. Neither reached
 * a decision, and telling drift from invention was never something a text
 * match could do. The verdict is the model's; the link is the app's.
 *
 * `not_checked` is for evidence that never went through the fetch stage at all
 * - seeded samples, imported records. It is not `blocked`: nobody tried.
 */
export type FetchStatus = 'ok' | 'unreachable' | 'blocked' | 'not_checked';

export interface Evidence {
  id: Uuid;
  checkId: Uuid;
  url: string;
  title: string | null;
  publisher: string | null;
  publishedAt: Iso | null;
  quotedText: string | null;
  tier: SourceTier | null;
  fetchStatus: FetchStatus;
  fetchedAt: Iso | null;
  createdAt: Iso;
  updatedAt: Iso;
  deletedAt: Iso | null;
}
