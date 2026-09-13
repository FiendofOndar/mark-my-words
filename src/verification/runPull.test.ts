import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { openDatabase, type Db } from '../data/db';
import { MemoryPersistence } from '../data/driver';
import { clearCooldown, describePull, readCooldown, runPull } from './runPull';
import type { PageFetchOutcome, PageFetcher } from './validateSources';
import { VerifierError, type CheckInput, type CheckResult, type StructureInput, type StructureResult, type Verifier } from './types';

const require = createRequire(import.meta.url);
const wasmDir = path.dirname(require.resolve('sql.js/dist/sql-wasm.js'));

const QUOTE = 'the thing definitively happened on Tuesday in front of everyone';

class ScriptedVerifier implements Verifier {
  readonly providerId = 'scripted';
  readonly modelId = 'scripted-1';
  readonly dailyQuota = null;
  calls = 0;
  constructor(private next: (input: CheckInput, call: number) => CheckResult | Error) {}
  async structure(_i: StructureInput): Promise<StructureResult> {
    throw new Error('not used');
  }
  async check(input: CheckInput): Promise<CheckResult> {
    this.calls += 1;
    const outcome = this.next(input, this.calls);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
  async testConnection(): Promise<void> {}
}

const echoFetcher: PageFetcher = {
  canProveUnreachable: true,
  async fetchPage(): Promise<PageFetchOutcome> {
    return { kind: 'ok' };
  },
};

function hitResult(confidence = 98): CheckResult {
  return {
    verdict: 'hit',
    trend: 'toward_yes',
    summary: 'It happened, widely reported.',
    criteriaStatus: [{ index: 0, satisfied: true, why: 'Reported.' }],
    sources: ['AP', 'Reuters', 'BBC'].map((publisher, i) => ({
      url: `https://outlet${i}.com/story`,
      title: 'It happened',
      publisher,
      publishedAt: new Date().toISOString().slice(0, 10),
      quotedText: QUOTE,
      tier: 'primary' as const,
    })),
    modelConfidence: confidence,
    provider: 'scripted',
    model: 'scripted-1',
    tokensUsed: 500,
  };
}

const nothingYet = (): CheckResult => ({
  ...hitResult(),
  verdict: 'no_change',
  trend: 'flat',
  summary: 'Nothing reported yet.',
  sources: [],
  criteriaStatus: [],
  modelConfidence: 10,
});

let db: Db;

beforeEach(async () => {
  db = await openDatabase({
    locateFile: (file) => path.join(wasmDir, file),
    persistence: new MemoryPersistence(),
    persistDebounceMs: 0,
  });
});

function addPrediction(overrides: { daysToDeadline?: number; lastCheckedAt?: string | null } = {}) {
  const author = db.authors.findOrCreate({ displayName: 'Popops' });
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + (overrides.daysToDeadline ?? 3));

  const prediction = db.predictions.create({
    authorId: author.id,
    rawStatement: 'The thing will happen.',
    statementDate: new Date(Date.now() - 86_400_000 * 30).toISOString(),
    deadlineType: 'fixed_date',
    resolutionDate: deadline.toISOString(),
    verificationMode: 'searchable',
    category: 'Other',
    criteria: ['The thing happens'],
  });

  if (overrides.lastCheckedAt !== undefined) {
    db.predictions.update(prediction.id, {
      lastCheckedAt: overrides.lastCheckedAt,
      updatedAt: new Date().toISOString(),
    });
  }
  return prediction;
}

describe('a pull', () => {
  it('survives a check that throws, and records it as a failed check', async () => {
    const broken = addPrediction();
    const fine = addPrediction();
    const verifier = new ScriptedVerifier(() => hitResult());
    // A fetcher is contractually never supposed to throw, which makes it the
    // easiest way to simulate a bug escaping `runCheck`. The first
    // prediction's three fetches blow up; the second's go through.
    let calls = 0;
    const flaky: PageFetcher = {
      canProveUnreachable: true,
      async fetchPage(url): Promise<PageFetchOutcome> {
        calls += 1;
        if (calls <= 3) throw new Error('the fetch layer blew up');
        return echoFetcher.fetchPage(url);
      },
    };

    const summary = await runPull(db, { verifier, fetcher: flaky }, { minGapMs: 0 });

    expect(summary.errors).toBe(1);
    expect(summary.resolved).toBe(1);
    expect(summary.plans).toHaveLength(2);
    const errorRows = [...db.checks.listFor(broken.id), ...db.checks.listFor(fine.id)].filter(
      (c) => c.outcome === 'error',
    );
    expect(errorRows).toHaveLength(1);
    expect(errorRows[0]!.summary).toMatch(/blew up/);
  });

  it('resolves a well-evidenced prediction and records the evidence', async () => {
    const prediction = addPrediction();
    const verifier = new ScriptedVerifier(() => hitResult());

    const summary = await runPull(db, { verifier, fetcher: echoFetcher }, { minGapMs: 0 });

    expect(summary).toMatchObject({ checked: 1, resolved: 1, errors: 0 });

    const after = db.predictions.getById(prediction.id)!;
    expect(after.status).toBe('hit');
    expect(after.resolvedBy).toBe('auto');
    expect(after.checkCount).toBe(1);
    expect(after.criteriaFrozenAt).toBeTruthy();

    const checks = db.checks.listFor(prediction.id);
    expect(checks).toHaveLength(1);
    expect(db.checks.evidenceFor(checks[0]!.id)).toHaveLength(3);
    expect(db.checks.evidenceFor(checks[0]!.id).every((e) => e.fetchStatus === 'ok')).toBe(true);
  });

  it('only checks what the cadence gate says is due', async () => {
    addPrediction({ daysToDeadline: 400, lastCheckedAt: new Date().toISOString() });
    addPrediction({ daysToDeadline: 3 });
    const verifier = new ScriptedVerifier(() => nothingYet());

    const summary = await runPull(db, { verifier, fetcher: echoFetcher }, { minGapMs: 0 });

    expect(verifier.calls).toBe(1);
    expect(summary.checked).toBe(1);
  });

  it('spends its budget and reports what it deferred', async () => {
    for (let i = 0; i < 5; i += 1) addPrediction();
    const verifier = new ScriptedVerifier(() => nothingYet());

    const summary = await runPull(db, { verifier, fetcher: echoFetcher }, { budget: 2, minGapMs: 0 });

    expect(verifier.calls).toBe(2);
    expect(summary.deferred).toBe(3);
    expect(describePull(summary)).toMatch(/3 deferred/);
  });

  it('reports progress so a slow pull is not mistaken for a stuck one', async () => {
    for (let i = 0; i < 3; i += 1) addPrediction();
    const verifier = new ScriptedVerifier(() => nothingYet());
    const seen: { done: number; total: number }[] = [];

    await runPull(
      db,
      { verifier, fetcher: echoFetcher },
      { minGapMs: 0, onProgress: (p) => seen.push(p) },
    );

    // One before the first check, then one after each.
    expect(seen).toEqual([
      { done: 0, total: 3 },
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
  });

  it('stops at the daily quota instead of failing partway', async () => {
    for (let i = 0; i < 4; i += 1) addPrediction();
    const verifier = new ScriptedVerifier(() => nothingYet());

    const first = await runPull(db, { verifier, fetcher: echoFetcher }, { dailyQuota: 3, minGapMs: 0 });
    expect(first.checked).toBe(3);
    expect(first.quotaBlocked).toBe(1);
    expect(db.quota.usedToday('scripted')).toBe(3);

    // The ceiling is a running total, not a per-pull allowance.
    const second = await runPull(db, { verifier, fetcher: echoFetcher }, { dailyQuota: 3, minGapMs: 0 });
    expect(second.checked).toBe(0);
    expect(second.quotaBlocked).toBeGreaterThan(0);
  });

  it('leaves a failed check due rather than pushing it a full interval out', async () => {
    const prediction = addPrediction();
    const verifier = new ScriptedVerifier(() => new VerifierError('Could not reach the model.', 'network'));

    const summary = await runPull(db, { verifier, fetcher: echoFetcher }, { minGapMs: 0 });

    expect(summary).toMatchObject({ checked: 0, errors: 1 });
    const after = db.predictions.getById(prediction.id)!;
    expect(after.lastCheckedAt).toBeNull();
    expect(after.criteriaFrozenAt).toBeNull();
    expect(db.checks.listFor(prediction.id)[0]!.outcome).toBe('error');

    // Still due on the next pull.
    const retry = await runPull(db, { verifier: new ScriptedVerifier(() => hitResult()), fetcher: echoFetcher }, { minGapMs: 0 });
    expect(retry.resolved).toBe(1);
  });

  it('queues a verdict the model itself is unsure of', async () => {
    const prediction = addPrediction();
    const verifier = new ScriptedVerifier(() => hitResult(55));

    const summary = await runPull(db, { verifier, fetcher: echoFetcher }, { minGapMs: 0 });

    expect(summary.queued).toBe(1);
    expect(db.predictions.getById(prediction.id)!.status).toBe('open');
    expect(db.checks.queuedVerdicts().get(prediction.id)?.proposedVerdict).toBe('hit');
  });

  it('hands the model what earlier checks found', async () => {
    addPrediction();
    const seen: (string | null)[] = [];
    const verifier = new ScriptedVerifier((input) => {
      seen.push(input.priorFindings);
      return nothingYet();
    });

    await runPull(db, { verifier, fetcher: echoFetcher }, { minGapMs: 0 });

    // Inside the final week the floor between checks is 12 hours, so the
    // second pull has to be later or the gate correctly refuses it.
    const later = new Date(Date.now() + 13 * 3_600_000);
    await runPull(
      db,
      { verifier, fetcher: echoFetcher, now: () => later },
      { now: () => later, minGapMs: 0 },
    );

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeNull();
    expect(seen[1]).toContain('Nothing reported yet.');
  });

  it('refuses a second pull inside the twelve hour floor', async () => {
    addPrediction();
    const verifier = new ScriptedVerifier(() => nothingYet());

    await runPull(db, { verifier, fetcher: echoFetcher }, { minGapMs: 0 });
    const second = await runPull(db, { verifier, fetcher: echoFetcher }, { minGapMs: 0 });

    expect(verifier.calls).toBe(1);
    expect(second.checked).toBe(0);
  });

  it('checks one prediction on demand, cadence or no cadence', async () => {
    const stale = addPrediction({ daysToDeadline: 400, lastCheckedAt: new Date().toISOString() });
    const verifier = new ScriptedVerifier(() => hitResult());

    const summary = await runPull(
      db,
      { verifier, fetcher: echoFetcher },
      { onlyPredictionId: stale.id, trigger: 'force', minGapMs: 0 },
    );

    expect(summary.resolved).toBe(1);
    expect(db.checks.listFor(stale.id)[0]!.trigger).toBe('force');
  });

  it('says plainly when nothing was due', async () => {
    addPrediction({ daysToDeadline: 400, lastCheckedAt: new Date().toISOString() });
    const summary = await runPull(
      db,
      { verifier: new ScriptedVerifier(() => nothingYet()), fetcher: echoFetcher },
      { minGapMs: 0 },
    );
    expect(describePull(summary)).toBe('Nothing was due');
  });
});


describe('staying under a per-minute limit', () => {
  it('spaces its calls rather than firing them back to back', async () => {
    addPrediction();
    addPrediction();
    const verifier = new ScriptedVerifier(() => nothingYet());

    const started = Date.now();
    await runPull(db, { verifier, fetcher: echoFetcher }, { minGapMs: 120 });
    const elapsed = Date.now() - started;

    expect(verifier.calls).toBe(2);
    // One gap between two calls, and none before the first.
    expect(elapsed).toBeGreaterThanOrEqual(110);
  });

  it('does not pause before the only call it makes', async () => {
    addPrediction();
    const started = Date.now();
    await runPull(
      db,
      { verifier: new ScriptedVerifier(() => nothingYet()), fetcher: echoFetcher },
      { minGapMs: 400 },
    );
    expect(Date.now() - started).toBeLessThan(400);
  });
});

describe('a spent allowance', () => {
  const dailyQuotaBody = JSON.stringify({
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      // The real shape a free key returns: no QuotaFailure, no RetryInfo,
      // just prose and a help link.
      message: 'You exceeded your current quota, please check your plan and billing details.',
      details: [{ '@type': 'type.googleapis.com/google.rpc.Help', links: [] }],
    },
  });

  const exhausted = () => new VerifierError('Rate limited', 'rate_limit', dailyQuotaBody, null);

  it('stops the pull instead of burning the rest of the budget on it', async () => {
    for (let i = 0; i < 4; i += 1) addPrediction();
    const verifier = new ScriptedVerifier(() => exhausted());

    const summary = await runPull(db, { verifier, fetcher: echoFetcher }, { minGapMs: 0 });

    expect(verifier.calls).toBe(1);
    expect(summary.cooledDown).not.toBeNull();
    expect(summary.quotaBlocked).toBeGreaterThan(0);
  });

  it('refuses to try again while the hold stands', async () => {
    addPrediction();
    await runPull(
      db,
      { verifier: new ScriptedVerifier(() => exhausted()), fetcher: echoFetcher },
      { minGapMs: 0 },
    );

    const second = new ScriptedVerifier(() => nothingYet());
    const summary = await runPull(db, { verifier: second, fetcher: echoFetcher }, { minGapMs: 0 });

    expect(second.calls).toBe(0);
    expect(summary.checked).toBe(0);
    expect(describePull(summary)).toMatch(/without saying for how long/i);
  });

  it('escalates to the daily reset only after it keeps happening', async () => {
    addPrediction();
    const verifier = new ScriptedVerifier(() => exhausted());

    // Three rounds, clearing the hold between them the way a user tapping
    // "Try anyway" would.
    for (let i = 0; i < 3; i += 1) {
      clearCooldown(db);
      await runPull(db, { verifier, fetcher: echoFetcher }, { minGapMs: 0 });
    }

    expect(readCooldown(db)!.reason).toMatch(/midnight Pacific/i);
  });

  it('lets checks resume once the hold is cleared', async () => {
    addPrediction();
    await runPull(
      db,
      { verifier: new ScriptedVerifier(() => exhausted()), fetcher: echoFetcher },
      { minGapMs: 0 },
    );
    expect(readCooldown(db)).not.toBeNull();

    clearCooldown(db);

    const verifier = new ScriptedVerifier(() => hitResult());
    const summary = await runPull(db, { verifier, fetcher: echoFetcher }, { minGapMs: 0 });
    expect(summary.resolved).toBe(1);
  });

  it('does not hold for a brief per-minute wait it can sit out', async () => {
    addPrediction();
    const perMinute = new VerifierError(
      'Rate limited',
      'rate_limit',
      JSON.stringify({
        error: {
          code: 429,
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
              violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }],
            },
            { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '30s' },
          ],
        },
      }),
      30,
    );

    await runPull(
      db,
      { verifier: new ScriptedVerifier(() => perMinute), fetcher: echoFetcher },
      { minGapMs: 0 },
    );

    const hold = readCooldown(db)!;
    // Thirty seconds, not until tomorrow morning.
    expect(new Date(hold.until).getTime() - Date.now()).toBeLessThan(35_000);
  });
});
