/**
 * The extraction eval: every screenshot in evals/screenshots, read by the
 * app's real extract path, against the expected fields in evals/extract.json.
 *
 * It runs in GitHub Actions (.github/workflows/eval.yml) because the runner
 * can reach Google and the phone is the only other thing that can. Each
 * screenshot is one image call on the model the app uses, with no search
 * grounding, so a run costs a few thousand tokens and no search fees.
 *
 *   GEMINI_API_KEY=... npm run eval:extract
 *   EVAL_PROVIDER=mock npm run eval:extract        # plumbing only, no spend
 *   EVAL_REPORT_FILE=out.md ...                    # also write the markdown table here
 *
 * A screenshot with no entry in extract.json still runs and is reported as
 * unconfirmed with the model's raw JSON, which is how the expected values get
 * written: the owner reads the result and confirms or corrects it in chat.
 * Never write an expected value the owner has not confirmed.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { GeminiVerifier } from '../src/verification/GeminiVerifier';
import { MockVerifier } from '../src/verification/MockVerifier';
import { VerifierError, type Verifier } from '../src/verification/types';
import { toLocalDateInput } from '../src/domain/prediction';
import {
  compareExtract,
  renderMarkdown,
  renderText,
  statusOf,
  summarize,
  type ExtractCases,
  type ExtractRow,
} from '../evals/lib/extractReport';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const root = resolve(new URL('..', import.meta.url).pathname);
const screenshotsDir = process.argv[2] ?? join(root, 'evals', 'screenshots');
const expectedPath = process.argv[3] ?? join(root, 'evals', 'extract.json');

function fail(message: string): never {
  console.error(message);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Extraction eval\n\n${message}\n`);
  }
  process.exit(1);
}

function makeVerifier(): Verifier {
  if (process.env.EVAL_PROVIDER === 'mock') return new MockVerifier();
  const apiKey = process.env.GEMINI_API_KEY ?? '';
  if (!apiKey.trim()) {
    fail(
      'GEMINI_API_KEY is not set. In GitHub Actions it comes from the repository secret of the same name; locally, export it before running. Nothing was called.',
    );
  }
  return new GeminiVerifier({ apiKey, model: process.env.GEMINI_MODEL || undefined });
}

const files = existsSync(screenshotsDir)
  ? readdirSync(screenshotsDir)
      .filter((name) => MIME[extname(name).toLowerCase()] !== undefined)
      .sort()
  : [];
if (files.length === 0) fail(`No screenshots in ${screenshotsDir}. Add .png, .jpg or .webp files there.`);

const cases: ExtractCases = existsSync(expectedPath) ? JSON.parse(readFileSync(expectedPath, 'utf8')) : {};
for (const name of Object.keys(cases)) {
  if (!files.includes(name)) console.warn(`  note  ${expectedPath} names ${name}, which is not in ${screenshotsDir}`);
}

const verifier = makeVerifier();
const defaultToday = toLocalDateInput(new Date().toISOString());
console.log(
  `Extraction eval: ${files.length} screenshot(s), model ${verifier.modelId}, today ${defaultToday} unless the case says otherwise\n`,
);

/**
 * One retry, only for a call that never answered. The first real run lost
 * one screenshot of six to a ninety-second timeout, which says nothing
 * about the prompt. A bad answer is never retried: that is the result.
 */
async function extractOnce(input: Parameters<Verifier['extract']>[0]) {
  try {
    return await verifier.extract(input);
  } catch (err) {
    if (err instanceof VerifierError && err.kind === 'network') {
      process.stdout.write(`(${err.message} retrying once) `);
      return await verifier.extract(input);
    }
    throw err;
  }
}

const rows: ExtractRow[] = [];
for (const file of files) {
  const entry = cases[file] ?? {};
  const today = entry.today ?? defaultToday;
  const path = join(screenshotsDir, file);
  const mimeType = MIME[extname(file).toLowerCase()] ?? 'image/png';
  process.stdout.write(`  ${basename(file)} ... `);
  try {
    const result = await extractOnce({
      imageBase64: readFileSync(path).toString('base64'),
      mimeType,
      today,
    });
    const diffs = entry.expect ? compareExtract(entry.expect, result.value) : [];
    const status = statusOf(entry.expect, diffs);
    rows.push({ file, status, diffs, rawText: result.rawText, tokens: result.tokensUsed, error: null });
    console.log(status);
  } catch (err) {
    const message =
      err instanceof VerifierError ? `${err.message} (${err.kind}${err.detail ? `: ${err.detail.slice(0, 300)}` : ''})` : String(err);
    rows.push({ file, status: 'error', diffs: [], rawText: null, tokens: null, error: message });
    console.log('error');
  }
}

const heading = `Extraction eval (${verifier.modelId}, ${new Date().toISOString().slice(0, 16)} UTC)`;
console.log(`\n${renderText(rows, heading)}`);
const markdown = renderMarkdown(rows, heading);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
if (process.env.EVAL_REPORT_FILE) {
  mkdirSync(dirname(process.env.EVAL_REPORT_FILE), { recursive: true });
  writeFileSync(process.env.EVAL_REPORT_FILE, markdown);
}

const counts = summarize(rows);
process.exit(counts.fail + counts.error > 0 ? 1 : 0);
