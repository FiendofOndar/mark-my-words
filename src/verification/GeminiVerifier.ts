import {
  VerifierError,
  type StructureInput,
  type StructureResult,
  type Verifier,
} from './types';
import { extractJson, parseStructuredPrediction } from './structureSchema';
import {
  STRUCTURE_RESPONSE_SCHEMA,
  STRUCTURE_SYSTEM_PROMPT,
  buildStructurePrompt,
} from './prompts/structure';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * Free-tier daily request cap. Published limits move, so this is only the
 * default for the quota meter; the real number belongs in settings.
 */
export const GEMINI_FREE_DAILY_REQUESTS = 200;

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
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

  private async post(path: string, body: unknown): Promise<GeminiResponse> {
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
      throw new VerifierError(describeStatus(response.status), kindForStatus(response.status), detail.slice(0, 500));
    }

    return (await response.json()) as GeminiResponse;
  }
}

function kindForStatus(status: number): VerifierError['kind'] {
  if (status === 400 || status === 401 || status === 403) return 'no_key';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'network';
  return 'unknown';
}

function describeStatus(status: number): string {
  switch (kindForStatus(status)) {
    case 'no_key':
      return 'The API key was rejected. Check it in Settings.';
    case 'rate_limit':
      return "Today's free quota is used up. Try again tomorrow.";
    case 'network':
      return 'The model is unavailable right now.';
    default:
      return `The request failed (${status}).`;
  }
}
