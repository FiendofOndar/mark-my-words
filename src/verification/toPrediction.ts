import type { NewPrediction } from '../data/repositories/predictionRepo';
import { endOfLocalDay, startOfLocalDay } from '../domain/prediction';
import type { IntakeNotes } from '../domain/types';
import type { StructureResult } from './types';

/**
 * The model's reading, turned into a draft row. Date-only values become local
 * start/end of day here, which is the only place that conversion happens for
 * intake.
 */
export function structuredToDraft(
  result: StructureResult,
  base: {
    authorId: string;
    rawStatement: string;
    statementDate: string;
    sourceUrl?: string | null;
    sourceContext?: string | null;
  },
): NewPrediction {
  const s = result.value;
  const isEvent = s.deadlineType === 'event';

  const notes: IntakeNotes = {
    deadlineReasoning: s.deadlineReasoning,
    verifiabilityReasoning: s.verifiabilityReasoning,
    ambiguities: s.ambiguities,
    warnings: result.warnings,
    provider: result.provider,
    model: result.model,
    draftedAt: new Date().toISOString(),
  };

  return {
    authorId: base.authorId,
    rawStatement: base.rawStatement,
    normalizedClaim: s.normalizedClaim,
    polarity: s.polarity,
    disconfirmingTrigger: s.disconfirmingTrigger,
    statementDate: base.statementDate,
    sourceUrl: base.sourceUrl ?? null,
    sourceContext: base.sourceContext ?? null,
    deadlineType: s.deadlineType,
    resolutionDate: s.resolutionDate ? endOfLocalDay(s.resolutionDate) : null,
    windowStart: s.windowStart ? startOfLocalDay(s.windowStart) : null,
    windowEnd: s.windowEnd ? endOfLocalDay(s.windowEnd) : null,
    triggerEvent: s.triggerEvent,
    triggerExpectedDate: s.triggerExpectedDate ? endOfLocalDay(s.triggerExpectedDate) : null,
    raceEventB: s.raceEventB,
    staleOutDate: isEvent && s.staleOutDate ? endOfLocalDay(s.staleOutDate) : null,
    verificationMode: s.verifiability,
    forceManual: false,
    searchQueries: s.searchQueries,
    noCheckBefore: s.noCheckBefore ? startOfLocalDay(s.noCheckBefore) : null,
    category: s.category,
    stakes: null,
    criteria: s.criteriaElements,
    intakeNotes: notes,
    status: 'draft',
  };
}

/** A draft holding nothing but the raw capture, for the fill-it-in-myself path. */
export function bareDraft(base: {
  authorId: string;
  rawStatement: string;
  statementDate: string;
  sourceUrl?: string | null;
  sourceContext?: string | null;
}): NewPrediction {
  return {
    authorId: base.authorId,
    rawStatement: base.rawStatement,
    statementDate: base.statementDate,
    sourceUrl: base.sourceUrl ?? null,
    sourceContext: base.sourceContext ?? null,
    deadlineType: 'fixed_date',
    verificationMode: 'searchable',
    category: 'Other',
    criteria: [],
    status: 'draft',
  };
}
