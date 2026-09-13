import type {
  Category,
  DeadlineType,
  Polarity,
  PredictionStatus,
  SourceTier,
  Trend,
  VerificationMode,
} from '../domain/types';

/** What the intake AI is asked to turn a raw quote into. */
export interface StructureInput {
  rawStatement: string;
  sourceUrl?: string | null;
  sourceContext?: string | null;
  /** ISO date (YYYY-MM-DD) the app considers "today". */
  today: string;
  /** e.g. "America/Los_Angeles", so the model resolves seasons correctly. */
  timezone?: string;
}

/**
 * The model's structured reading of a statement. Dates here are date-only
 * (YYYY-MM-DD); the UI converts them to local start/end of day before storage.
 */
export interface StructuredPrediction {
  normalizedClaim: string;
  polarity: Polarity;
  disconfirmingTrigger: string | null;
  criteriaElements: string[];

  deadlineType: DeadlineType;
  resolutionDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  triggerEvent: string | null;
  triggerExpectedDate: string | null;
  raceEventB: string | null;
  staleOutDate: string | null;
  deadlineReasoning: string;

  verifiability: VerificationMode;
  verifiabilityReasoning: string;
  searchQueries: string[];
  noCheckBefore: string | null;

  category: Category;
  tags: string[];
  authorGuess: string | null;
  statementDateGuess: string | null;
  /** Things the user must settle before the clock starts. */
  ambiguities: string[];
}

export interface StructureResult {
  value: StructuredPrediction;
  /** Fields the app had to repair. Shown to the user, not hidden. */
  warnings: string[];
  provider: string;
  model: string;
  tokensUsed: number | null;
}

/** Mirrors the `trigger` column on a check row. */
export type CheckTriggerKind = 'pull' | 'force' | 'deadline' | 'backfill';

/** What a verification pass is asked to settle. */
export interface CheckInput {
  claim: string;
  polarity: Polarity;
  disconfirmingTrigger: string | null;
  criteriaElements: string[];
  statementDate: string;
  deadlineDescription: string;
  raceEventB: string | null;
  suggestedQueries: string[];
  /** A short digest of the last couple of checks, so the model has continuity. */
  priorFindings: string | null;
  today: string;
}

export type CheckVerdict = Extract<
  PredictionStatus,
  'hit' | 'miss' | 'partial' | 'ambiguous'
> | 'no_change';

export interface CitedSource {
  url: string;
  title: string | null;
  publisher: string | null;
  publishedAt: string | null;
  quotedText: string;
  tier: SourceTier;
}

export interface CriterionStatus {
  index: number;
  satisfied: boolean;
  why: string;
}

export interface CheckResult {
  verdict: CheckVerdict;
  trend: Trend;
  summary: string;
  criteriaStatus: CriterionStatus[];
  sources: CitedSource[];
  /** 0-100, as reported. Used only to lower the app's own score. */
  modelConfidence: number | null;
  provider: string;
  model: string;
  tokensUsed: number | null;
  /**
   * The searches the provider actually ran, when it says.
   *
   * Grounded checks are billed per search query, not per prompt, so this is
   * the line item. The prompt asks the model to stop at three agreeing sources
   * and never exceed twelve searches, and a prompt cannot enforce either: this
   * is how anyone finds out whether it listened. It is also the clearest record
   * of why a check went wrong, since a verdict built on the wrong sources
   * usually started with the wrong query.
   */
  searchQueries?: string[] | null;
  /**
   * Something the provider returned that the app could not read, verbatim,
   * so it can be diagnosed from the check log instead of guessed at. Used
   * today for a grounded response that reports no search queries: the field
   * name was written from memory once and did not work, and the only way to
   * see what actually arrives is to show it.
   */
  providerNote?: string | null;
}

export class VerifierError extends Error {
  constructor(
    message: string,
    readonly kind:
      | 'no_key'
      | 'bad_model'
      | 'network'
      | 'rate_limit'
      | 'bad_response'
      | 'refused'
      | 'unknown',
    readonly detail?: string,
    /** Seconds Google asked us to wait, when it said. */
    readonly retryAfterSeconds?: number | null,
  ) {
    super(message);
    this.name = 'VerifierError';
  }
}

export interface Verifier {
  readonly providerId: string;
  readonly modelId: string;
  /** null when the provider publishes no daily cap. */
  readonly dailyQuota: number | null;
  structure(input: StructureInput): Promise<StructureResult>;
  check(input: CheckInput): Promise<CheckResult>;
  /** Cheap round trip to prove the key works. */
  testConnection(): Promise<void>;
}
