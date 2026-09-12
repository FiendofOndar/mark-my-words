import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Db } from '../data/db';
import { useDb } from './DbProvider';
import type { Author, Category, Prediction, PredictionStatus } from '../domain/types';
import { sortByHeat, type HeatInput } from '../domain/heat';
import { isPastDeadline } from '../domain/prediction';
import type { PredictionPatch } from '../domain/prediction';
import type { NewPrediction } from '../data/repositories/predictionRepo';
import { tallyRecord, type AuthorRecord } from '../domain/scoring';
import { confirmDraft } from '../domain/prediction';
import { createVerifier } from '../verification/registry';
import type { StructureInput, StructureResult } from '../verification/types';

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
}

const RESOLVED: PredictionStatus[] = ['hit', 'miss', 'partial', 'ambiguous'];

/** A prediction only you can settle, and the clock has run out. */
export function awaitsUser(p: Prediction, now = new Date()): boolean {
  if (p.status === 'draft') return true;
  if (p.status !== 'open') return false;
  if (p.verificationMode !== 'manual') return false;
  return isPastDeadline(p, now);
}

function matches(p: Prediction, filter: FeedFilter, now: Date): boolean {
  switch (filter.kind) {
    case 'all':
      return true;
    case 'open':
      return p.status === 'open' || p.status === 'draft';
    case 'needs_you':
      return awaitsUser(p, now);
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

  const items = db.predictions
    .list()
    .filter((p) => matches(p, filter, now))
    .flatMap<FeedItem>((prediction) => {
      const author = authors.get(prediction.authorId);
      if (!author) return [];
      return [
        {
          prediction,
          author,
          amendmentCount: amendmentCounts.get(prediction.id) ?? 0,
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

export function useAuthors() {
  const db = useDb();
  return useQuery({ queryKey: keys.authors(), queryFn: () => db.authors.list() });
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
          record: tallyRecord(all.filter((p) => p.authorId === author.id)),
        }))
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
  return useDbMutation((db, input: NewPrediction) => db.predictions.create(input));
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

export function useSetCriterionSatisfied() {
  return useDbMutation((db, args: { id: string; satisfied: boolean | null }) =>
    db.predictions.setCriterionSatisfied(args.id, args.satisfied),
  );
}
