import {
  VerifierError,
  type CheckInput,
  type CheckResult,
  type StructureInput,
  type StructureResult,
  type Verifier,
} from './types';
import { extractJson, parseStructuredPrediction } from './structureSchema';
import { parseCheckResponse } from './checkSchema';
import { describeQuotaFailure, parseQuotaFailure } from './quotaError';
import {
  STRUCTURE_RESPONSE_SCHEMA,
  STRUCTURE_SYSTEM_PROMPT,
  buildStructurePrompt,
} from './prompts/structure';
import { CHECK_RESPONSE_SCHEMA, CHECK_SYSTEM_PROMPT, buildCheckPrompt } from './prompts/check';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * An alias rather than a pinned version. Google retires specific versions for
 * new accounts without warning (2.5-flash went that way), and an alias keeps
 * following whatever the current fast model is. Settings can list what a key
 * actually has access to, which is the real answer when this goes stale again.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

/**
 * Free-tier daily request cap. Published limits move, so this is only the
 * default for the quota meter; the real number belongs in settings.
 */
export const GEMINI_FREE_DAILY_REQUESTS = 200;

/** Longer than this and waiting inline is worse than reporting it. */
const MAX_AUTO_RETRY_SECONDS = 70;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface GeminiModel {
  name: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: { totalTokenCount?: number };
  promptFeedback?: { blockReason?: string };
}

export class GeminiVerifier implements Verifier {
  readonly providerId = 'gemini';
  readonly modelId: string;
  readonly dailyQuota = GEMINI_FREE_DAILY_REQUESTS;

  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: GeminiOptions) {
    if (!opts.apiKey.trim()) {
      throw new VerifierError('No Gemini API key is set.', 'no_key');
    }
    this.apiKey = opts.apiKey.trim();
    this.modelId = opts.model?.trim() || DEFAULT_GEMINI_MODEL;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 45_000;
  }

  async structure(input: StructureInput): Promise<StructureResult> {
    const body = {
      systemInstruction: { parts: [{ text: STRUCTURE_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: buildStructurePrompt(input) }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: STRUCTURE_RESPONSE_SCHEMA,
      },
    };

    const response = await this.post(`${this.modelId}:generateContent`, body);
    const text = this.firstText(response);

    let raw: unknown;
    try {
      raw = extractJson(text);
    } catch (err) {
      throw new VerifierError(
        'The model did not return usable JSON.',
        'bad_response',
        (err as Error).message,
      );
    }

    const parsed = parseStructuredPrediction(raw, { today: input.today });
    if (!parsed.ok) {
      throw new VerifierError(
        'The model returned a reading that cannot be stored.',
        'bad_response',
        parsed.problems.join(' '),
      );
    }

    return {
      value: parsed.value,
      warnings: parsed.warnings,
      provider: this.providerId,
      model: this.modelId,
      tokensUsed: response.usageMetadata?.totalTokenCount ?? null,
    };
  }

  /**
   * Verification runs with Google Search grounding. Gemini does not allow a
   * declared responseSchema alongside a tool, so the JSON shape is asked for in
   * the prompt and the parser does the enforcing it would otherwise do.
   */
  async check(input: CheckInput): Promise<CheckResult> {
    const body = {
      systemInstruction: {
        parts: [
          {
            text: `${CHECK_SYSTEM_PROMPT}\n\nReturn a single JSON object with exactly this shape:\n${JSON.stringify(
              CHECK_RESPONSE_SCHEMA,
              null,
              1,
            )}`,
          },
        ],
      },
      contents: [{ role: 'user', parts: [{ text: buildCheckPrompt(input) }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.1 },
    };

    const response = await this.post(`${this.modelId}:generateContent`, body);
    const text = this.firstText(response);

    let raw: unknown;
    try {
      raw = extractJson(text);
    } catch (err) {
      throw new VerifierError(
        'The check did not come back as JSON.',
        'bad_response',
        (err as Error).message,
      );
    }

    const parsed = parseCheckResponse(raw, input.criteriaElements.length);
    if (!parsed.ok) {
      throw new VerifierError(
        'The check came back unusable.',
        'bad_response',
        parsed.problems.join(' '),
      );
    }

    return {
      ...parsed.value,
      provider: this.providerId,
      model: this.modelId,
      tokensUsed: response.usageMetadata?.totalTokenCount ?? null,
    };
  }

  /**
   * What this key can actually use. Model ids change and get retired per
   * account, so the app asks rather than assuming.
   */
  async listModels(): Promise<{ id: string; label: string }[]> {
    const response = await this.get('?pageSize=1000');
    const models = (response as { models?: GeminiModel[] }).models ?? [];

    return models
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => ({
        id: m.name.replace(/^models\//, ''),
        label: m.displayName ?? m.name.replace(/^models\//, ''),
      }))
      // Fast models first: they are the cheap, high-quota ones this app wants.
      .sort((a, b) => {
        const rank = (id: string) => (id.includes('flash') ? 0 : id.includes('pro') ? 1 : 2);
        return rank(a.id) - rank(b.id) || a.id.localeCompare(b.id);
      });
  }

  async testConnection(): Promise<void> {
    await this.post(`${this.modelId}:generateContent`, {
      contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ready' }] }],
      generationConfig: { maxOutputTokens: 16, temperature: 0 },
    });
  }

  private firstText(response: GeminiResponse): string {
    if (response.promptFeedback?.blockReason) {
      throw new VerifierError(
        'The model declined to read that statement.',
        'refused',
        response.promptFeedback.blockReason,
      );
    }

    const candidate = response.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

    if (!text.trim()) {
      // MAX_TOKENS here means the JSON was cut off mid-object, which reads as
      // an empty response rather than an error.
      throw new VerifierError(
        'The model returned nothing usable.',
        'bad_response',
        candidate?.finishReason ?? 'empty response',
      );
    }
    return text;
  }

  private async get(query: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${BASE}/models${query}`, {
        headers: { 'x-goog-api-key': this.apiKey },
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        if (response.status === 429) {
          const failure = parseQuotaFailure(detail);
          throw new VerifierError(
            describeQuotaFailure(failure),
            'rate_limit',
            detail,
            failure?.retryAfterSeconds ?? null,
          );
        }
        throw new VerifierError(describeStatus(response.status), kindForStatus(response.status), detail);
      }
      return await response.json();
    } catch (err) {
      if (err instanceof VerifierError) throw err;
      const aborted = (err as Error).name === 'AbortError';
      throw new VerifierError(
        aborted ? 'The request timed out.' : 'Could not reach the model.',
        'network',
        (err as Error).message,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async post(path: string, body: unknown, attempt = 0): Promise<GeminiResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${BASE}/models/${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = (err as Error).name === 'AbortError';
      throw new VerifierError(
        aborted ? 'The request timed out.' : 'Could not reach the model.',
        'network',
        (err as Error).message,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');

      if (response.status === 429) {
        const failure = parseQuotaFailure(detail);
        const wait = failure?.retryAfterSeconds ?? null;

        // Google usually names a short wait for a per-minute limit. Waiting it
        // out once is far better than telling someone to come back tomorrow.
        if (attempt === 0 && wait !== null && wait > 0 && wait <= MAX_AUTO_RETRY_SECONDS) {
          await sleep(wait * 1000 + 250);
          return this.post(path, body, attempt + 1);
        }

        throw new VerifierError(describeQuotaFailure(failure), 'rate_limit', detail, wait);
      }

      throw new VerifierError(describeStatus(response.status), kindForStatus(response.status), detail);
    }

    return (await response.json()) as GeminiResponse;
  }
}

function kindForStatus(status: number): VerifierError['kind'] {
  if (status === 400 || status === 401 || status === 403) return 'no_key';
  if (status === 404) return 'bad_model';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'network';
  return 'unknown';
}

function describeStatus(status: number): string {
  switch (kindForStatus(status)) {
    case 'no_key':
      return 'The API key was rejected. Check it in Settings.';
    case 'bad_model':
      return 'That model does not exist for this key. Pick one from the list.';
    case 'rate_limit':
      return 'Rate limited. Wait a moment and try again.';
    case 'network':
      return 'The model is unavailable right now.';
    default:
      return `The request failed (${status}).`;
  }
}
