import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_GEMINI_MODEL, GeminiVerifier } from './GeminiVerifier';
import { VerifierError, type StructureInput } from './types';

const INPUT: StructureInput = {
  rawStatement: 'The Cardinals will win the World Series this year.',
  today: '2026-09-12',
};

const GOOD_JSON = JSON.stringify({
  normalized_claim: 'The St. Louis Cardinals win the 2026 World Series.',
  polarity: 'positive',
  criteria_elements: ['The St. Louis Cardinals win the 2026 World Series'],
  deadline_type: 'fixed_date',
  resolution_date: '2026-11-05',
  deadline_reasoning: 'The series ends in early November.',
  verifiability: 'searchable',
  verifiability_reasoning: 'Widely reported.',
  search_queries: ['2026 World Series winner'],
  category: 'Sports',
  ambiguities: ['Arizona Cardinals or St. Louis Cardinals?'],
});

// Typed parameters so mock.calls is a real tuple and the assertions below can
// read the URL and the request body.
type FetchArgs = [RequestInfo | URL, RequestInit?];

function respondWith(text: string, extra: Record<string, unknown> = {}) {
  return vi.fn(async (..._args: FetchArgs) =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text }] } }],
        usageMetadata: { totalTokenCount: 812 },
        ...extra,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
}

function failWith(status: number, body = '{"error":{"message":"nope"}}') {
  return vi.fn(async (..._args: FetchArgs) => new Response(body, { status }));
}

function verifier(fetchImpl: typeof fetch, model?: string) {
  return new GeminiVerifier({ apiKey: 'test-key-123', fetchImpl, model, timeoutMs: 1000 });
}

describe('construction', () => {
  it('refuses an empty key', () => {
    expect(() => new GeminiVerifier({ apiKey: '   ' })).toThrow(VerifierError);
  });

  it('defaults the model and lets it be overridden', () => {
    expect(verifier(respondWith(GOOD_JSON) as never).modelId).toBe(DEFAULT_GEMINI_MODEL);
    expect(verifier(respondWith(GOOD_JSON) as never, 'gemini-3-pro').modelId).toBe('gemini-3-pro');
  });
});

describe('structure', () => {
  it('parses a well-formed response', async () => {
    const fetchImpl = respondWith(GOOD_JSON);
    const result = await verifier(fetchImpl as never).structure(INPUT);

    expect(result.value.normalizedClaim).toContain('Cardinals');
    expect(result.value.category).toBe('Sports');
    expect(result.value.ambiguities).toHaveLength(1);
    expect(result.tokensUsed).toBe(812);
    expect(result.provider).toBe('gemini');
  });

  it('sends the key as a header and the model in the path', async () => {
    const fetchImpl = respondWith(GOOD_JSON);
    await verifier(fetchImpl as never, 'gemini-x').structure(INPUT);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('/models/gemini-x:generateContent');
    expect(init!.headers).toMatchObject({ 'x-goog-api-key': 'test-key-123' });
    // The key must never end up in the URL, where it would land in logs.
    expect(String(url)).not.toContain('test-key-123');
  });

  it('asks for JSON back', async () => {
    const fetchImpl = respondWith(GOOD_JSON);
    await verifier(fetchImpl as never).structure(INPUT);

    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema.properties.normalized_claim).toBeDefined();
    expect(body.contents[0].parts[0].text).toContain('2026-09-12');
    expect(body.contents[0].parts[0].text).toContain('Cardinals');
  });

  it('survives a response wrapped in a markdown fence', async () => {
    const fetchImpl = respondWith('```json\n' + GOOD_JSON + '\n```');
    const result = await verifier(fetchImpl as never).structure(INPUT);
    expect(result.value.deadlineType).toBe('fixed_date');
  });

  it('reports a rejected key', async () => {
    await expect(verifier(failWith(400) as never).structure(INPUT)).rejects.toMatchObject({
      kind: 'no_key',
    });
    await expect(verifier(failWith(403) as never).structure(INPUT)).rejects.toMatchObject({
      kind: 'no_key',
    });
  });

  it('reports an exhausted quota separately from other failures', async () => {
    await expect(verifier(failWith(429) as never).structure(INPUT)).rejects.toMatchObject({
      kind: 'rate_limit',
    });
  });

  it('treats a server error as a network problem', async () => {
    await expect(verifier(failWith(503) as never).structure(INPUT)).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('reports an unreachable model', async () => {
    const fetchImpl = vi.fn(async (..._args: FetchArgs) => {
      throw new TypeError('Failed to fetch');
    });
    await expect(verifier(fetchImpl as never).structure(INPUT)).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('reports a timeout as a timeout', async () => {
    const fetchImpl = vi.fn(async (..._args: FetchArgs) => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });
    const error = await verifier(fetchImpl as never)
      .structure(INPUT)
      .catch((e: VerifierError) => e);
    expect(error).toMatchObject({ kind: 'network' });
    expect((error as VerifierError).message).toMatch(/timed out/i);
  });

  it('reports a refusal distinctly from a bad response', async () => {
    const fetchImpl = vi.fn(
      async (..._args: FetchArgs) =>
        new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 }),
    );
    await expect(verifier(fetchImpl as never).structure(INPUT)).rejects.toMatchObject({
      kind: 'refused',
    });
  });

  it('reports truncated output rather than silently returning nothing', async () => {
    const fetchImpl = vi.fn(
      async (..._args: FetchArgs) =>
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }),
          { status: 200 },
        ),
    );
    const error = await verifier(fetchImpl as never)
      .structure(INPUT)
      .catch((e: VerifierError) => e);
    expect(error).toMatchObject({ kind: 'bad_response' });
    expect((error as VerifierError).detail).toBe('MAX_TOKENS');
  });

  it('rejects unparseable output', async () => {
    await expect(
      verifier(respondWith('I cannot help with that.') as never).structure(INPUT),
    ).rejects.toMatchObject({ kind: 'bad_response' });
  });

  it('rejects output that parses but cannot be stored, and says why', async () => {
    const body = JSON.stringify({
      normalized_claim: 'The bubble will not crash.',
      polarity: 'negative',
      criteria_elements: ['No crash'],
      deadline_type: 'fixed_date',
      resolution_date: '2027-03-01',
    });
    const error = await verifier(respondWith(body) as never)
      .structure(INPUT)
      .catch((e: VerifierError) => e);
    expect(error).toMatchObject({ kind: 'bad_response' });
    expect((error as VerifierError).detail).toMatch(/nothing to search/i);
  });
});

const CHECK_INPUT = {
  claim: 'The Eagles win Super Bowl LIX.',
  statementDate: '2025-01-20',
  today: '2025-02-10',
  polarity: 'positive' as const,
  disconfirmingTrigger: null,
  deadlineDescription: 'By February 9, 2025',
  criteriaElements: ['The Eagles win Super Bowl LIX'],
  raceEventB: null,
  suggestedQueries: ['super bowl lix result'],
  priorFindings: null,
};

const CHECK_JSON = JSON.stringify({
  verdict: 'hit',
  trend: 'toward_yes',
  summary: 'The Eagles beat the Chiefs 40-22.',
  criteria_status: [{ index: 0, satisfied: true, basis: 'quoted', why: 'Final score.' }],
  sources: [
    {
      url: 'https://apnews.com/a',
      publisher: 'AP',
      published_at: '2025-02-10',
      quoted_text: 'Eagles 40, Chiefs 22',
      tier: 'major_outlet',
    },
  ],
  model_confidence: 96,
});

describe('check', () => {
  it('runs with search grounding and no response schema', async () => {
    // Gemini rejects a declared responseSchema alongside a tool, which is why
    // the JSON shape is asked for in the prompt instead.
    const fetchImpl = respondWith(CHECK_JSON);
    await verifier(fetchImpl as never).check(CHECK_INPUT);

    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(body.tools).toEqual([{ google_search: {} }]);
    expect(body.generationConfig.responseSchema).toBeUndefined();
  });

  /*
   * The billing line item. Grounded checks are charged per search query, and
   * the prompt's own ceiling of twelve is unenforceable, so the only way to
   * find out what a check cost is to record what the model says it ran.
   */
  it('records the searches the model actually ran', async () => {
    const fetchImpl = vi.fn(async (..._args: FetchArgs) =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: CHECK_JSON }] },
              groundingMetadata: {
                webSearchQueries: ['super bowl lix final score', 'eagles chiefs 2025'],
              },
            },
          ],
          usageMetadata: { totalTokenCount: 812 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await verifier(fetchImpl as never).check(CHECK_INPUT);
    expect(result.searchQueries).toEqual([
      'super bowl lix final score',
      'eagles chiefs 2025',
    ]);
  });

  it('reports nothing rather than none when the provider does not say', async () => {
    // "We were not told" and "it ran no searches" are different facts.
    const result = await verifier(respondWith(CHECK_JSON) as never).check(CHECK_INPUT);
    expect(result.searchQueries).toBeNull();
  });
});

describe('testConnection', () => {
  it('makes a small request and does not ask for the big schema', async () => {
    const fetchImpl = respondWith('ready');
    await verifier(fetchImpl as never).testConnection();
    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(body.generationConfig.responseSchema).toBeUndefined();
    expect(body.generationConfig.maxOutputTokens).toBe(16);
  });

  it('surfaces a bad key', async () => {
    await expect(verifier(failWith(400) as never).testConnection()).rejects.toMatchObject({
      kind: 'no_key',
    });
  });
});

describe('listing what a key can use', () => {
  const MODELS = JSON.stringify({
    models: [
      { name: 'models/gemini-pro-latest', displayName: 'Gemini Pro', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/embedding-001', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-flash-latest', displayName: 'Gemini Flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/aqa', displayName: 'AQA', supportedGenerationMethods: ['generateAnswer'] },
    ],
  });

  function respondOk(body: string) {
    return vi.fn(async (..._args: FetchArgs) => new Response(body, { status: 200 }));
  }

  it('returns only models that can actually generate content', async () => {
    const found = await verifier(respondOk(MODELS) as never).listModels();
    expect(found.map((m) => m.id)).toEqual(['gemini-flash-latest', 'gemini-pro-latest']);
  });

  it('strips the models/ prefix and keeps the display name', async () => {
    const found = await verifier(respondOk(MODELS) as never).listModels();
    expect(found[0]).toEqual({ id: 'gemini-flash-latest', label: 'Gemini Flash' });
  });

  it('sends the key as a header on the listing too', async () => {
    const fetchImpl = respondOk(MODELS);
    await verifier(fetchImpl as never).listModels();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('/models?');
    expect(init!.headers).toMatchObject({ 'x-goog-api-key': 'test-key-123' });
  });

  it('copes with a key that has nothing', async () => {
    const found = await verifier(respondOk('{}') as never).listModels();
    expect(found).toEqual([]);
  });

  it('reports a rejected key rather than returning an empty list', async () => {
    await expect(verifier(failWith(403) as never).listModels()).rejects.toMatchObject({
      kind: 'no_key',
    });
  });
});

describe('a retired model', () => {
  it('is reported as a model problem, not a key problem', async () => {
    // Google retires specific versions per account; saying "check your key"
    // sends you to look at the wrong thing entirely.
    const body = '{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available to new users."}}';
    const error = await verifier(failWith(404, body) as never)
      .structure(INPUT)
      .catch((e: VerifierError) => e);

    expect(error).toMatchObject({ kind: 'bad_model' });
    expect((error as VerifierError).message).toMatch(/does not exist for this key/i);
    // The whole message survives, including the part naming the replacement.
    expect((error as VerifierError).detail).toContain('no longer available');
  });
});

describe('rate limits', () => {
  const quotaBody = (quotaId: string, retryDelay?: string) =>
    JSON.stringify({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [{ quotaId, quotaValue: '10' }],
          },
          ...(retryDelay
            ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }]
            : []),
        ],
      },
    });

  it('waits out a short per-minute limit instead of giving up', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (..._args: FetchArgs) => {
      calls += 1;
      return calls === 1
        ? new Response(quotaBody('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '0.05s'), {
            status: 429,
          })
        : new Response(
            JSON.stringify({ candidates: [{ content: { parts: [{ text: GOOD_JSON }] } }] }),
            { status: 200 },
          );
    });

    const result = await verifier(fetchImpl as never).structure(INPUT);
    expect(calls).toBe(2);
    expect(result.value.normalizedClaim).toContain('Cardinals');
  });

  it('retries at most once, then reports honestly', async () => {
    const fetchImpl = vi.fn(
      async (..._args: FetchArgs) =>
        new Response(quotaBody('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '0.05s'), {
          status: 429,
        }),
    );

    const error = await verifier(fetchImpl as never)
      .structure(INPUT)
      .catch((e: VerifierError) => e);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(error).toMatchObject({ kind: 'rate_limit' });
    expect((error as VerifierError).message).toMatch(/last minute/i);
  });

  it('does not sit waiting on a limit that lasts hours', async () => {
    const fetchImpl = vi.fn(
      async (..._args: FetchArgs) =>
        new Response(quotaBody('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '7200s'), {
          status: 429,
        }),
    );

    const error = await verifier(fetchImpl as never)
      .structure(INPUT)
      .catch((e: VerifierError) => e);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((error as VerifierError).message).toMatch(/used up/i);
    expect((error as VerifierError).retryAfterSeconds).toBe(7200);
  });

  it('never tells you to come back tomorrow for a per-minute limit', async () => {
    const fetchImpl = vi.fn(
      async (..._args: FetchArgs) =>
        new Response(quotaBody('GenerateRequestsPerMinutePerProjectPerModel-FreeTier'), {
          status: 429,
        }),
    );
    const error = await verifier(fetchImpl as never)
      .structure(INPUT)
      .catch((e: VerifierError) => e);
    expect((error as VerifierError).message).not.toMatch(/tomorrow/i);
  });

  it('separates the grounding allowance from the request allowance', async () => {
    const fetchImpl = vi.fn(
      async (..._args: FetchArgs) =>
        new Response(quotaBody('GroundingWithGoogleSearchRequestsPerDay-FreeTier'), { status: 429 }),
    );
    const error = await verifier(fetchImpl as never)
      .structure(INPUT)
      .catch((e: VerifierError) => e);
    expect((error as VerifierError).message).toMatch(/drafting still works/i);
  });
});
