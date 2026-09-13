import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Db } from '../data/db';
import { useDb } from './DbProvider';
import type { Author, Category, Prediction, PredictionStatus } from '../domain/types';
import { sortByHeat, type HeatInput } from '../domain/heat';
import { checkedButUnsettled, isPastDeadline, criteriaMarksFor } from '../domain/prediction';
import type { PredictionPatch } from '../domain/prediction';
import type { NewPrediction } from '../data/repositories/predictionRepo';
import { tallyRecord, type AuthorRecord } from '../domain/scoring';
import { confirmDraft, markLateHit, resolve } from '../domain/prediction';
import { snoozePrompt } from '../domain/notifications';
import { createVerifier } from '../verification/registry';
import type { StructureInput, StructureResult } from '../verification/types';
import type { Check, Evidence } from '../domain/types';
import {
  clearCooldown,
  describePull,
  readCooldown,
  runPull,
  type PullSummary,
} from '../verification/runPull';
import { describeCooldown } from '../verification/cooldown';
import { BrowserPageFetcher, type PageFetcher } from '../verification/validateSources';
import { CapacitorPageFetcher } from '../platform/CapacitorPageFetcher';
import { isNative } from '../platform';
import { loadVerifierConfig } from '../lib/keyStore';
import { DEFAULT_PULL_BUDGET } from '../domain/cadence';
import { archiveSource } from '../capture/archive';
import { archiveHttp } from '../capture/http';

export type FeedFilter =
  | { kind: 'all' }
  | { kind: 'open' }
  | { kind: 'needs_you' }
  | { kind: 'resolved' }
  | { kind: 'late' }
  | { kind: 'void' }
  | { kind: 'category'; category: Category }
  | { kind: 'author'; authorId: string };

export interface FeedItem extends HeatInput {
  author: Author;
  amendmentCount: number;
  queuedVerdict: Check | null;
}

const RESOLVED: PredictionStatus[] = ['hit', 'miss', 'partial', 'ambiguous'];

/** A prediction only you can settle, and the clock has run out. */
export function awaitsUser(p: Prediction, now = new Date(), hasQueuedVerdict = false): boolean {
  if (p.status === 'draft') return true;
  if (hasQueuedVerdict) return true;
  if (p.status !== 'open') return false;
  // Searched for, past due, and still unsettled: the app has done what it can.
  if (checkedButUnsettled(p, now)) return true;
  if (p.verificationMode !== 'manual') return false;
  return isPastDeadline(p, now);
}

function matches(
  p: Prediction,
  filter: FeedFilter,
  now: Date,
  queued: Map<string, Check>,
): boolean {
  switch (filter.kind) {
    case 'all':
      return true;
    case 'open':
      return p.status === 'open' || p.status === 'draft';
    case 'needs_you':
      return awaitsUser(p, now, queued.has(p.id));
    case 'resolved':
      return RESOLVED.includes(p.status);
    case 'late':
      return p.lateHitAt !== null;
    case 'void':
      return p.status === 'void';
    case 'category':
      return p.category === filter.category;
    case 'author':
      return p.authorId === filter.authorId;
  }
}

function buildFeed(db: Db, filter: FeedFilter): FeedItem[] {
  const now = new Date();
  const authors = new Map(db.authors.list().map((a) => [a.id, a]));
  const amendmentCounts = db.predictions.amendmentCounts();
  const queued = db.checks.queuedVerdicts();

  const items = db.predictions
    .list()
    .filter((p) => matches(p, filter, now, queued))
    .flatMap<FeedItem>((prediction) => {
      const author = authors.get(prediction.authorId);
      if (!author) return [];
      return [
        {
          prediction,
          author,
          amendmentCount: amendmentCounts.get(prediction.id) ?? 0,
          hasQueuedVerdict: queued.has(prediction.id),
          queuedVerdict: queued.get(prediction.id) ?? null,
        },
      ];
    });

  return sortByHeat(items, now) as FeedItem[];
}

export const keys = {
  feed: (filter: FeedFilter) => ['feed', filter] as const,
  prediction: (id: string) => ['prediction', id] as const,
  authors: () => ['authors'] as const,
  standings: () => ['standings'] as const,
  checks: (id: string) => ['checks', id] as const,
  queued: () => ['queued'] as const,
  quota: () => ['quota'] as const,
};

export function useFeed(filter: FeedFilter) {
  const db = useDb();
  return useQuery({
    queryKey: keys.feed(filter),
    queryFn: () => buildFeed(db, filter),
  });
}

export function usePrediction(id: string | undefined) {
  const db = useDb();
  return useQuery({
    queryKey: keys.prediction(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => {
      if (!id) return null;
      const context = db.predictions.getWithContext(id);
      if (!context) return null;
      return { ...context, amendments: db.predictions.amendmentsFor(id) };
    },
  });
}

export interface CheckLogEntry {
  check: Check;
  evidence: Evidence[];
}

export function useCheckLog(predictionId: string | undefined) {
  const db = useDb();
  return useQuery({
    queryKey: keys.checks(predictionId ?? ''),
    enabled: Boolean(predictionId),
    queryFn: (): CheckLogEntry[] => {
      if (!predictionId) return [];
      const evidence = db.checks.evidenceByCheck(predictionId);
      return db.checks
        .listFor(predictionId)
        .map((check) => ({ check, evidence: evidence.get(check.id) ?? [] }));
    },
  });
}

/** Predictions whose latest check proposed a verdict nobody has acted on. */
export function useQueuedVerdicts() {
  const db = useDb();
  return useQuery({
    queryKey: keys.queued(),
    queryFn: () => db.checks.queuedVerdicts(),
  });
}

export function useQuotaUsed() {
  const db = useDb();
  const config = loadVerifierConfig();
  return useQuery({
    queryKey: keys.quota(),
    queryFn: () => ({
      used: db.quota.usedToday(config.provider),
      thisMonth: db.quota.usedThisMonth(config.provider),
      searchesThisMonth: db.quota.searchesThisMonth(),
      tokens: db.quota.tokensUsed(),
      limit: config.dailyQuota,
      provider: config.provider,
    }),
  });
}

export function useAuthors() {
  const db = useDb();
  return useQuery({ queryKey: keys.authors(), queryFn: () => db.authors.list() });
}

export function useAuthorPage(authorId: string | undefined) {
  const db = useDb();
  return useQuery({
    queryKey: ['author', authorId],
    enabled: Boolean(authorId),
    queryFn: () => {
      if (!authorId) return null;
      const author = db.authors.getById(authorId);
      if (!author) return null;

      const predictions = db.predictions.list({ authorId });
      const amendmentCounts = db.predictions.amendmentCounts();
      const queued = db.checks.queuedVerdicts();
      const now = new Date();

      const items: FeedItem[] = predictions.map((prediction) => ({
        prediction,
        author,
        amendmentCount: amendmentCounts.get(prediction.id) ?? 0,
        hasQueuedVerdict: queued.has(prediction.id),
        queuedVerdict: queued.get(prediction.id) ?? null,
      }));

      const firstSeen = predictions
        .map((p) => p.statementDate)
        .sort()[0] ?? null;

      return {
        author,
        record: tallyRecord(predictions),
        items: sortByHeat(items, now) as FeedItem[],
        firstSeen,
      };
    },
  });
}

export interface Standing {
  author: Author;
  record: AuthorRecord;
}

export function useStandings() {
  const db = useDb();
  return useQuery({
    queryKey: keys.standings(),
    queryFn: (): Standing[] => {
      const all = db.predictions.list();
      return db.authors
        .list()
        .map((author) => ({
          author,
          predictions: all.filter((p) => p.authorId === author.id),
        }))
        // An author with nothing on the record is not a standing. This happens
        // after deleting someone's only prediction.
        .filter(({ predictions }) => predictions.length > 0)
        .map(({ author, predictions }) => ({ author, record: tallyRecord(predictions) }))
        .sort((a, b) => {
          if (a.record.ranked !== b.record.ranked) return a.record.ranked ? -1 : 1;
          return (b.record.rate ?? -1) - (a.record.rate ?? -1);
        });
    },
  });
}

/** Every write goes through here so cache invalidation happens in exactly one place. */
function useDbMutation<TArgs, TResult>(fn: (db: Db, args: TArgs) => TResult) {
  const db = useDb();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs) => {
      const result = fn(db, args);
      await db.driver.persist();
      return result;
    },
    onSuccess: () => {
      void client.invalidateQueries();
    },
  });
}

export function useCreatePrediction() {
  const db = useDb();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: NewPrediction) => {
      const prediction = db.predictions.create(input);
      await db.driver.persist();

      // Fired after the row exists, so a slow or failing archive never costs
      // the capture. Whatever it returns is recorded; pending gets retried on
      // the next app open. Wrapped because losing a capture to an archiving
      // problem would be the worst possible trade.
      if (prediction.sourceUrl) {
        try {
          const outcome = await archiveSource(prediction.sourceUrl, archiveHttp);
          db.predictions.recordArchiveAttempt(prediction.id, outcome);
          await db.driver.persist();
        } catch {
          /* stays pending, the retry queue will pick it up */
        }
      }

      return prediction;
    },
    onSuccess: () => {
      void client.invalidateQueries();
    },
  });
}

export function useUpdatePrediction() {
  return useDbMutation((db, args: { id: string; patch: PredictionPatch }) => {
    db.predictions.update(args.id, args.patch);
  });
}

export function useDeletePrediction() {
  return useDbMutation((db, id: string) => db.predictions.softDelete(id));
}

export function useAmendPrediction() {
  return useDbMutation(
    (db, args: { id: string; field: keyof Prediction; value: string; reason: string }) =>
      db.predictions.amend(args.id, args.field, args.value, args.reason),
  );
}

export function useAmendCriterion() {
  return useDbMutation((db, args: { criterionId: string; text: string; reason: string }) =>
    db.predictions.amendCriterion(args.criterionId, args.text, args.reason),
  );
}

export function useFindOrCreateAuthor() {
  return useDbMutation((db, args: { displayName: string; handle?: string | null }) =>
    db.authors.findOrCreate(args),
  );
}

export function useUpdateDraft() {
  return useDbMutation((db, args: { id: string; input: NewPrediction }) =>
    db.predictions.updateDraft(args.id, args.input),
  );
}

/**
 * Flip a draft to open. This is the moment the clock starts and the record
 * becomes something you can be held to.
 */
export function useConfirmDraft() {
  return useDbMutation((db, id: string) => {
    const prediction = db.predictions.getById(id);
    if (!prediction) throw new Error(`No prediction ${id}`);
    db.predictions.update(id, confirmDraft(prediction));
  });
}

/**
 * The intake call. Not a database mutation, so it does not invalidate caches
 * and does not need the db at all.
 */
export function useStructureStatement() {
  return useMutation<StructureResult, Error, StructureInput>({
    mutationFn: (input) => createVerifier().structure(input),
  });
}

function pageFetcher(): PageFetcher {
  // The browser fetcher cannot tell a dead URL from a cross-origin refusal, so
  // nothing auto-resolves on the web build. The native one goes through native
  // code, sees real status codes, and the gates start biting.
  return isNative() ? new CapacitorPageFetcher() : new BrowserPageFetcher();
}

/** Run a pull. The only thing in the app that spends quota. */
export function usePull() {
  const db = useDb();
  const client = useQueryClient();

  // Checks are spaced to stay under a per-minute cap, so a full pull runs for
  // most of a minute. This is what turns that into "3 of 6" instead of a word
  // that could equally mean the thing has hung.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const mutation = useMutation<PullSummary, Error, { onlyPredictionId?: string } | void>({
    mutationFn: async (args) => {
      const config = loadVerifierConfig();
      return runPull(
        db,
        { verifier: createVerifier(config), fetcher: pageFetcher() },
        {
          budget: DEFAULT_PULL_BUDGET,
          dailyQuota: config.dailyQuota,
          onProgress: setProgress,
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

  return { ...mutation, progress };
}

export { describePull };

/** The provider's allowance is spent; nothing will be checked until it resets. */
export function useCooldown() {
  const db = useDb();
  return useQuery({
    queryKey: ['cooldown'],
    queryFn: () => {
      const cooldown = readCooldown(db);
      return cooldown ? { cooldown, message: describeCooldown(cooldown) } : null;
    },
    // The only query with a deadline of its own, so it has to age out.
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useClearCooldown() {
  return useDbMutation((db) => clearCooldown(db));
}

/** Accept a queued verdict. The record shows you made the call, not the model. */
export function useApproveVerdict() {
  return useDbMutation((db, args: { predictionId: string; checkId: string }) => {
    const prediction = db.predictions.getById(args.predictionId);
    const check = db.checks.listFor(args.predictionId).find((c) => c.id === args.checkId);
    if (!prediction || !check || !check.proposedVerdict || check.proposedVerdict === 'no_change') {
      throw new Error('There is no verdict to approve.');
    }

    // The prediction may have moved since the verdict was queued: settled by
    // hand, reopened, or already carrying this exact verdict. Accepting is then
    // just acknowledging the proposal, not applying it again.
    if (prediction.status === check.proposedVerdict) {
      db.checks.markActedOn(args.checkId, 'auto_resolved');
      return;
    }

    if (prediction.status === 'miss' && check.proposedVerdict === 'hit') {
      // A late hit never overwrites the verdict; it earns the badge.
      if (!prediction.lateHitAt) {
        db.predictions.update(args.predictionId, markLateHit(prediction, check.ranAt));
      }
    } else {
      db.predictions.update(
        args.predictionId,
        resolve(prediction, check.proposedVerdict, 'user', new Date()),
      );
    }
    db.checks.markActedOn(args.checkId, 'auto_resolved');
  });
}

/**
 * Settle a prediction by hand.
 *
 * Also clears any proposal that was waiting, because once the user has made the
 * call there is nothing left to approve and leaving the card up reads as an
 * unfinished job.
 */
export function useResolveManually() {
  return useDbMutation(
    (db, args: { id: string; verdict: PredictionStatus; by?: 'user' | 'user_override' }) => {
      const prediction = db.predictions.getById(args.id);
      if (!prediction) throw new Error(`No prediction ${args.id}`);

      db.predictions.update(args.id, resolve(prediction, args.verdict, args.by ?? 'user'));

      // The stamp and the criterion marks must agree. A check writes the
      // marks itself; a person calling it by hand did not, and the marks are
      // read-only on a searchable claim, so a manual HIT sat above three
      // question marks.
      for (const mark of criteriaMarksFor(args.verdict, db.predictions.criteriaFor(args.id))) {
        db.predictions.setCriterionSatisfied(mark.id, mark.satisfied);
      }

      const pending = db.checks.queuedVerdicts().get(args.id);
      if (pending) db.checks.markActedOn(pending.id, 'no_change');
    },
  );
}

export function useRejectVerdict() {
  return useDbMutation((db, checkId: string) => db.checks.markActedOn(checkId, 'no_change'));
}

/** "Not yet" on a prediction only you can settle. Pushes the ask out a week. */
export function useSnoozePrompt() {
  return useDbMutation((db, id: string) => {
    const prediction = db.predictions.getById(id);
    if (!prediction) throw new Error(`No prediction ${id}`);
    db.predictions.update(id, snoozePrompt(prediction));
  });
}

export function useSetCriterionSatisfied() {
  return useDbMutation((db, args: { id: string; satisfied: boolean | null }) =>
    db.predictions.setCriterionSatisfied(args.id, args.satisfied),
  );
}
