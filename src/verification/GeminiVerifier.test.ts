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
