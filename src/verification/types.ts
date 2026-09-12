import type { Category, DeadlineType, Polarity, VerificationMode } from '../domain/types';

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

export class VerifierError extends Error {
  constructor(
    message: string,
    readonly kind: 'no_key' | 'network' | 'rate_limit' | 'bad_response' | 'refused' | 'unknown',
    readonly detail?: string,
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
  /** Cheap round trip to prove the key works. */
  testConnection(): Promise<void>;
}
