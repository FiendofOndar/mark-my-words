import { describe, expect, it } from 'vitest';
import { runCheck, type CheckDeps } from './runCheck';
import type { PageFetchOutcome, PageFetcher } from './validateSources';
import { VerifierError, type CheckInput, type CheckResult, type CitedSource, type StructureInput, type StructureResult, type Verifier } from './types';
import { makePrediction, NOW, isoDaysFrom } from '../domain/fixtures';
import type { CriteriaElement, Prediction } from '../domain/types';

function criteria(texts: string[], predictionId = 'p-1'): CriteriaElement[] {
  return texts.map((text, position) => ({
    id: `c-${position}`,
    predictionId,
    position,
    text,
    satisfied: null,
    satisfiedAt: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    deletedAt: null,
  }));
}

function citedSource(overrides: Partial<CitedSource> = {}): CitedSource {
  return {
    url: 'https://apnews.com/article/one',
    title: 'It happened',
    publisher: 'AP',
    publishedAt: '2026-10-01',
    quotedText: 'the thing definitively happened on Tuesday in front of everyone',
    tier: 'primary',
    ...overrides,
  };
}

class StubVerifier implements Verifier {
  readonly providerId = 'stub';
  readonly modelId = 'stub-1';
  readonly dailyQuota = null;
  constructor(private result: CheckResult | Error) {}
  async structure(_input: StructureInput): Promise<StructureResult> {
    throw new Error('not used');
  }
  async check(_input: CheckInput): Promise<CheckResult> {
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
  async testConnection(): Promise<void> {}
}

class StubFetcher implements PageFetcher {
  readonly canProveUnreachable = true;
  constructor(private outcome: (url: string) => PageFetchOutcome) {}
  async fetchPage(url: string): Promise<PageFetchOutcome> {
    return this.outcome(url);
  }
}

const pageAnswers: PageFetcher = new StubFetcher(() => ({ kind: 'ok' }));

function result(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    verdict: 'hit',
    trend: 'toward_yes',
    summary: 'It happened.',
    criteriaStatus: [{ index: 0, satisfied: true, why: 'Reported.' }],
    sources: [
      citedSource(),
      citedSource({ url: 'https://reuters.com/a', publisher: 'Reuters' }),
      citedSource({ url: 'https://bbc.co.uk/a', publisher: 'BBC' }),
    ],
    modelConfidence: 95,
    provider: 'stub',
    model: 'stub-1',
    tokensUsed: 400,
    ...overrides,
  };
}

function deps(verifierResult: CheckResult | Error, fetcher: PageFetcher = pageAnswers): CheckDeps {
  return { verifier: new StubVerifier(verifierResult), fetcher, now: () => NOW };
}

function ctx(prediction: Prediction, texts = ['The thing happens']) {
  return {
    prediction,
    criteria: criteria(texts, prediction.id),
    priorFindings: null,
    trigger: 'pull' as const,
  };
}

describe('a decisive, well-sourced check', () => {
  it('auto-resolves', async () => {
    const plan = await runCheck(deps(result()), ctx(makePrediction()));

    expect(plan.outcome).toBe('resolved');
    expect(plan.predictionPatch).toMatchObject({ status: 'hit', resolvedBy: 'auto' });
    expect(plan.check!.gates).toEqual([]);
    expect(plan.check!.outcome).toBe('auto_resolved');
    expect(plan.check!.evidence).toHaveLength(3);
    expect(plan.countsAsChecked).toBe(true);
  });

  it('seals the criteria on the first check and not again after', async () => {
    const fresh = await runCheck(deps(result()), ctx(makePrediction()));
    expect(fresh.freeze).toBe(true);

    const already = await runCheck(
      deps(result()),
      ctx(makePrediction({ criteriaFrozenAt: NOW.toISOString() })),
    );
    expect(already.freeze).toBe(false);
  });

  it('records which criteria the evidence satisfied', async () => {
    const plan = await runCheck(
      deps(
        result({
          criteriaStatus: [
            { index: 0, satisfied: true, why: '' },
            { index: 1, satisfied: false, why: '' },
          ],
        }),
      ),
      ctx(makePrediction(), ['First thing', 'Second thing']),
    );
    expect(plan.criteriaUpdates).toEqual([
      { id: 'c-0', satisfied: true },
      { id: 'c-1', satisfied: false },
    ]);
  });
});

describe('a check that should not decide anything', () => {
  it('moves the trend and leaves the prediction open on no_change', async () => {
    const plan = await runCheck(
      deps(result({ verdict: 'no_change', trend: 'toward_no', sources: [] })),
      ctx(makePrediction()),
    );
    expect(plan.outcome).toBe('no_change');
    expect(plan.predictionPatch).toMatchObject({ trend: 'toward_no', checkCount: 1 });
    expect(plan.predictionPatch!.status).toBeUndefined();
  });

  it('queues a verdict the model is not sure of', async () => {
    const plan = await runCheck(
      deps(result({ modelConfidence: 60 })),
      ctx(makePrediction()),
    );
    expect(plan.outcome).toBe('queued');
    expect(plan.check!.outcome).toBe('queued');
    expect(plan.check!.proposedVerdict).toBe('hit');
    expect(plan.predictionPatch!.status).toBeUndefined();
  });

  it('asks about a verdict propped up by one thin source rather than burying it', async () => {
    const plan = await runCheck(
      deps(result({ sources: [citedSource({ tier: 'social' })], modelConfidence: 30 })),
      ctx(makePrediction()),
    );
    expect(plan.outcome).toBe('queued');
    expect(plan.assessment!.gates.join(' ')).toMatch(/one independent source/i);
  });

  it('never auto-resolves a prediction the user reserved for themselves', async () => {
    const plan = await runCheck(
      deps(result({ modelConfidence: 100 })),
      ctx(makePrediction({ forceManual: true })),
    );
    expect(plan.outcome).toBe('queued');
  });
});

describe('source validation feeds the decision', () => {
  it('resolves on real pages whatever their wording, since the app no longer reads it', async () => {
    const plan = await runCheck(deps(result(), new StubFetcher(() => ({ kind: 'ok' }))), ctx(makePrediction()));
    expect(plan.sources.every((s) => s.fetchStatus === 'ok')).toBe(true);
    expect(plan.outcome).toBe('resolved');
  });

  it('treats an unreachable citation as a reason to stop', async () => {
    const plan = await runCheck(
      deps(result(), new StubFetcher(() => ({ kind: 'unreachable' }))),
      ctx(makePrediction()),
    );
    expect(plan.outcome).not.toBe('resolved');
    expect(plan.assessment!.gates.join(' ')).toMatch(/invented/i);
  });

  it('resolves when sources could not be read at all, since that accuses nobody', () => {
    // The browser case: CORS stops the app reading the page. Blocked is not
    // proof of a bad citation, so it scores nothing and gates nothing.
    return runCheck(
      deps(result({ modelConfidence: 100 }), new StubFetcher(() => ({ kind: 'blocked' }))),
      ctx(makePrediction()),
    ).then((plan) => {
      expect(plan.outcome).toBe('resolved');
      expect(plan.assessment!.gates).toEqual([]);
    });
  });

  it('never resolves on a citation that did not resolve', async () => {
    // The one guard that survives: a dead URL is the signature of an invented
    // source, and no amount of confidence gets past it.
    const plan = await runCheck(
      deps(result({ modelConfidence: 100 }), new StubFetcher(() => ({ kind: 'unreachable' }))),
      ctx(makePrediction()),
    );
    expect(plan.outcome).toBe('queued');
    expect(plan.assessment!.gates.join(' ')).toMatch(/invented citations/i);
  });
});

describe('a claim that something will not happen', () => {
  const negative = (daysToDeadline: number) =>
    makePrediction({
      polarity: 'negative',
      disconfirmingTrigger: 'The neighbors raise the gutters again',
      resolutionDate: isoDaysFrom(NOW, daysToDeadline),
    });
  const nothingFound = () =>
    result({ verdict: 'no_change', trend: 'flat', summary: 'No mention found.', sources: [] });

  it('queues a hit for approval once the deadline passes with nothing found', async () => {
    // An absence has no sources, so it can never arrive as a verdict. Before
    // this, negative claims sat open until the person noticed.
    const plan = await runCheck(deps(nothingFound()), ctx(negative(-2)));
    expect(plan.outcome).toBe('queued');
    expect(plan.check!.proposedVerdict).toBe('hit');
    expect(plan.check!.outcome).toBe('queued');
    expect(plan.check!.summary).toMatch(/gutters/);
    expect(plan.predictionPatch!.status).toBeUndefined();
  });

  it('is still just no_change before the deadline', async () => {
    const plan = await runCheck(deps(nothingFound()), ctx(negative(30)));
    expect(plan.outcome).toBe('no_change');
    expect(plan.check!.proposedVerdict).toBe('no_change');
  });

  it('applies a miss when the disconfirming event was found', async () => {
    const plan = await runCheck(deps(result({ verdict: 'miss' })), ctx(negative(-2)));
    expect(plan.outcome).toBe('resolved');
    expect(plan.predictionPatch!.status).toBe('miss');
  });
});

describe('late hits', () => {
  const lateWatched = () =>
    makePrediction({
      status: 'miss',
      resolutionDate: isoDaysFrom(NOW, -400),
      lateWatchUntil: isoDaysFrom(NOW, 365),
      resolvedAt: isoDaysFrom(NOW, -400),
    });

  it('badges a resolved miss instead of changing its verdict', async () => {
    const plan = await runCheck(deps(result()), ctx(lateWatched()));
    expect(plan.outcome).toBe('late_hit');
    expect(plan.predictionPatch!.status).toBeUndefined();
    expect(plan.predictionPatch!.lateHitAt).toBeTruthy();
  });

  it('dates the late hit from the earliest source that reported it', async () => {
    const plan = await runCheck(
      deps(
        result({
          sources: [
            citedSource({ publishedAt: '2027-03-05' }),
            citedSource({ url: 'https://reuters.com/a', publisher: 'Reuters', publishedAt: '2027-01-09' }),
            citedSource({ url: 'https://bbc.co.uk/a', publisher: 'BBC', publishedAt: '2027-02-01' }),
          ],
        }),
      ),
      ctx(lateWatched()),
    );
    expect(plan.predictionPatch!.lateHitAt).toContain('2027-01-09');
  });

  it('queues a weakly evidenced late hit rather than badging it', async () => {
    const plan = await runCheck(deps(result({ modelConfidence: 50 })), ctx(lateWatched()));
    expect(plan.outcome).toBe('queued');
  });

  it('records a re-check that confirms the miss without touching the verdict', async () => {
    // The likeliest answer on a settled miss is "still a miss", and it used to
    // throw on the miss-to-miss transition and take the whole pull down.
    const plan = await runCheck(
      deps(result({ verdict: 'miss', summary: 'Still has not happened.' })),
      ctx(lateWatched()),
    );
    expect(plan.outcome).toBe('no_change');
    expect(plan.check!.outcome).toBe('no_change');
    expect(plan.check!.proposedVerdict).toBe('miss');
    expect(plan.predictionPatch!.status).toBeUndefined();
    expect(plan.predictionPatch!.lateHitAt).toBeUndefined();
    expect(plan.predictionPatch!.lastCheckedAt).toBeTruthy();
    expect(plan.countsAsChecked).toBe(true);
  });

  it('holds a late-watch partial or ambiguous answer the same way', async () => {
    const plan = await runCheck(deps(result({ verdict: 'ambiguous' })), ctx(lateWatched()));
    expect(plan.outcome).toBe('no_change');
    expect(plan.predictionPatch!.status).toBeUndefined();
  });
});

describe('stale-out', () => {
  it('voids an event that ran out its rope without calling the model', async () => {
    const failing = deps(new Error('the model must not be called'));
    const plan = await runCheck(
      failing,
      ctx(
        makePrediction({
          deadlineType: 'event',
          resolutionDate: null,
          triggerEvent: 'the film releases',
          staleOutDate: isoDaysFrom(NOW, -1),
        }),
      ),
    );
    expect(plan.outcome).toBe('staled_out');
    expect(plan.predictionPatch).toMatchObject({ status: 'void', resolvedBy: 'auto' });
    expect(plan.check!.provider).toBe('system');
  });
});

describe('failures', () => {
  it('records the error without consuming the cadence slot', async () => {
    const plan = await runCheck(
      deps(new VerifierError('Today\'s free quota is used up.', 'rate_limit', 'HTTP 429')),
      ctx(makePrediction()),
    );

    expect(plan.outcome).toBe('error');
    expect(plan.countsAsChecked).toBe(false);
    expect(plan.predictionPatch).toBeNull();
    expect(plan.check!.outcome).toBe('error');
    expect(plan.check!.errorMessage).toBe('HTTP 429');
  });

  it('does not freeze the criteria on a failed check', async () => {
    const plan = await runCheck(deps(new Error('boom')), ctx(makePrediction()));
    expect(plan.freeze).toBe(false);
  });
});

describe('what the model is told', () => {
  it('hands a negative claim its disconfirming trigger, not the negative', async () => {
    let seen: CheckInput | null = null;
    const verifier = new StubVerifier(result({ verdict: 'no_change', sources: [] }));
    const spy: Verifier = {
      providerId: verifier.providerId,
      modelId: verifier.modelId,
      structure: (input) => verifier.structure(input),
      testConnection: () => verifier.testConnection(),
      check: async (input) => {
        seen = input;
        return verifier.check(input);
      },
    };

    await runCheck(
      { verifier: spy, fetcher: pageAnswers, now: () => NOW },
      ctx(
        makePrediction({
          polarity: 'negative',
          disconfirmingTrigger: 'An index falls 30% from its peak',
        }),
      ),
    );

    expect(seen!.polarity).toBe('negative');
    expect(seen!.disconfirmingTrigger).toBe('An index falls 30% from its peak');
    expect(seen!.today).toBe('2026-09-12');
  });

  it('dates the prompt locally, not in UTC', async () => {
    // Eight in the evening Pacific, which is already tomorrow in UTC. The
    // deadline the model is asked to compare against is rendered in local time,
    // so a UTC "today" put the two a day apart every evening, and on a claim
    // about one particular day that is the whole answer. The suite runs in
    // Pacific so this can fail.
    const evening = new Date(2026, 8, 12, 20, 0, 0);
    expect(evening.toISOString().slice(0, 10)).toBe('2026-09-13');

    let seen: CheckInput | null = null;
    const verifier = new StubVerifier(result({ verdict: 'no_change', sources: [] }));
    const spy: Verifier = {
      providerId: verifier.providerId,
      modelId: verifier.modelId,
      structure: (input) => verifier.structure(input),
      testConnection: () => verifier.testConnection(),
      check: async (input) => {
        seen = input;
        return verifier.check(input);
      },
    };

    await runCheck(
      { verifier: spy, fetcher: pageAnswers, now: () => evening },
      ctx(makePrediction()),
    );

    expect(seen!.today).toBe('2026-09-12');
  });
});

describe('things with nothing left to decide', () => {
  it('skips a settled prediction instead of throwing on the transition', async () => {
    // A force check bypasses the cadence gate, so it can reach a prediction
    // that already carries the verdict the model is about to confirm.
    const plan = await runCheck(
      deps(result()),
      ctx(makePrediction({ status: 'hit', resolvedAt: NOW.toISOString(), resolvedBy: 'user' })),
    );

    expect(plan.outcome).toBe('skipped');
    expect(plan.check).toBeNull();
    expect(plan.predictionPatch).toBeNull();
    expect(plan.countsAsChecked).toBe(false);
  });

  it('skips a draft, which has no clock running', async () => {
    const plan = await runCheck(deps(result()), ctx(makePrediction({ status: 'draft' })));
    expect(plan.outcome).toBe('skipped');
  });

  it('still checks a settled miss that is under late watch', async () => {
    const plan = await runCheck(
      deps(result()),
      ctx(
        makePrediction({
          status: 'miss',
          resolutionDate: isoDaysFrom(NOW, -400),
          lateWatchUntil: isoDaysFrom(NOW, 365),
        }),
      ),
    );
    expect(plan.outcome).toBe('late_hit');
  });
});
