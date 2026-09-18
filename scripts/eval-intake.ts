/**
 * The intake eval: every statement in evals/intake.json through the app's
 * real structuring path (GeminiVerifier.structure: same prompt, same schema,
 * same parser), graded against what the review card must get right.
 *
 * It runs in GitHub Actions (.github/workflows/eval.yml) because the runner
 * can reach Google. Each statement is one text call on the model the app
 * uses, no image, no search grounding, so a run costs a few thousand tokens
 * per statement and no search fees.
 *
 *   GEMINI_API_KEY=... npm run eval:intake
 *   EVAL_PROVIDER=mock npm run eval:intake        # plumbing only, no spend
 *   EVAL_REPORT_FILE=out.md ...                   # also write the markdown table here
 *   EVAL_READINGS_FILE=readings.json ...          # also save what the model read, per case
 *
 * A case with `proposed` values and no `expect` runs and is reported as
 * unconfirmed, with the proposal graded beside the model's reading so the
 * owner can confirm or correct it in chat. Only a confirmed value moves to
 * `expect`. Never write an expected value the owner has not confirmed.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { GeminiVerifier } from '../src/verification/GeminiVerifier';
import { MockVerifier } from '../src/verification/MockVerifier';
import { VerifierError, type Verifier } from '../src/verification/types';
import { toLocalDateInput } from '../src/domain/prediction';
import {
  compareIntake,
  renderMarkdown,
  renderText,
  statusOf,
  summarize,
  type IntakeCases,
  type IntakeRow,
} from '../evals/lib/intakeReport';
import type { StructuredPrediction } from '../src/verification/types';

const root = resolve(new URL('..', import.meta.url).pathname);
const casesPath = process.argv[2] ?? join(root, 'evals', 'intake.json');

function fail(message: string): never {
  console.error(message);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Intake eval\n\n${message}\n`);
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

if (!existsSync(casesPath)) fail(`No case file at ${casesPath}.`);
const cases: IntakeCases = JSON.parse(readFileSync(casesPath, 'utf8'));
const ids = Object.keys(cases);
if (ids.length === 0) fail(`${casesPath} has no cases.`);

const verifier = makeVerifier();
const defaultToday = toLocalDateInput(new Date().toISOString());
console.log(`Intake eval: ${ids.length} statement(s), model ${verifier.modelId}\n`);

/** One retry, only for a call that never answered. A bad answer is the result. */
async function structureOnce(input: Parameters<Verifier['structure']>[0]) {
  try {
    return await verifier.structure(input);
  } catch (err) {
    if (err instanceof VerifierError && err.kind === 'network') {
      process.stdout.write(`(${err.message} retrying once) `);
      return await verifier.structure(input);
    }
    throw err;
  }
}

const rows: IntakeRow[] = [];
for (const id of ids) {
  const entry = cases[id]!;
  process.stdout.write(`  ${id} ... `);
  const base = {
    id,
    statement: entry.statement,
    tests: entry.tests ?? null,
    proposedCount: Object.keys(entry.proposed ?? {}).length,
  };
  try {
    const result = await structureOnce({
      rawStatement: entry.statement,
      today: entry.today ?? defaultToday,
      timezone: entry.timezone ?? 'America/Los_Angeles',
      sourceContext: entry.sourceContext ?? null,
    });
    const diffs = entry.expect ? compareIntake(entry.expect, result.value) : [];
    const proposalDiffs = entry.proposed ? compareIntake(entry.proposed, result.value) : [];
    const status = statusOf(entry.expect, diffs);
    rows.push({
      ...base,
      status,
      diffs,
      proposalDiffs,
      value: result.value,
      warnings: result.warnings,
      tokens: result.tokensUsed,
      error: null,
    });
    console.log(status);
  } catch (err) {
    const message =
      err instanceof VerifierError ? `${err.message} (${err.kind}${err.detail ? `: ${err.detail.slice(0, 300)}` : ''})` : String(err);
    rows.push({ ...base, status: 'error', diffs: [], proposalDiffs: [], value: null, warnings: [], tokens: null, error: message });
    console.log('error');
  }
}

const heading = `Intake eval (${verifier.modelId}, ${new Date().toISOString().slice(0, 16)} UTC)`;
console.log(`\n${renderText(rows, heading)}`);
const markdown = renderMarkdown(rows, heading);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
if (process.env.EVAL_REPORT_FILE) {
  mkdirSync(dirname(process.env.EVAL_REPORT_FILE), { recursive: true });
  writeFileSync(process.env.EVAL_REPORT_FILE, markdown);
}

// The readings, keyed by case, so the review sheet can be regenerated
// without paying for another run. scripts/review-intake.ts reads this.
if (process.env.EVAL_READINGS_FILE) {
  const readings: Record<string, StructuredPrediction> = {};
  for (const row of rows) if (row.value) readings[row.id] = row.value;
  mkdirSync(dirname(process.env.EVAL_READINGS_FILE), { recursive: true });
  writeFileSync(process.env.EVAL_READINGS_FILE, `${JSON.stringify(readings, null, 2)}\n`);
}

const counts = summarize(rows);
process.exit(counts.fail + counts.error > 0 ? 1 : 0);
