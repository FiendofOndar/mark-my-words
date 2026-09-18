/**
 * Render the intake review sheet: every proposed value in plain English,
 * beside what the model returned, with the handful that need a judgment at
 * the top.
 *
 * Spends nothing. It reads a readings file an eval run already produced
 * (EVAL_READINGS_FILE, saved as a workflow artifact) rather than calling
 * the model again, so the sheet can be regenerated after editing the case
 * file without paying for anything.
 *
 *   npm run review:intake -- evals/readings/intake-17.json > sheet.md
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { renderReview } from '../evals/lib/intakeReview';
import type { IntakeCases } from '../evals/lib/intakeReport';
import type { StructuredPrediction } from '../src/verification/types';

const root = resolve(new URL('..', import.meta.url).pathname);
const readingsPath = process.argv[2];
const casesPath = process.argv[3] ?? join(root, 'evals', 'intake.json');

if (!readingsPath) {
  console.error(
    'Usage: npm run review:intake -- <readings.json> [cases.json]\n\n' +
      'The readings file is what an eval run wrote with EVAL_READINGS_FILE set;\n' +
      'the Prompt eval workflow saves one as an artifact on every intake run.',
  );
  process.exit(1);
}
for (const p of [readingsPath, casesPath]) {
  if (!existsSync(p)) {
    console.error(`No file at ${p}.`);
    process.exit(1);
  }
}

const cases: IntakeCases = JSON.parse(readFileSync(casesPath, 'utf8'));
const readings: Record<string, StructuredPrediction> = JSON.parse(readFileSync(readingsPath, 'utf8'));

const missing = Object.keys(cases).filter((id) => !readings[id]);
if (missing.length > 0) {
  console.error(`  note  no reading for: ${missing.join(', ')}`);
}

process.stdout.write(
  renderReview(cases, readings, {
    heading: 'Intake eval: the values waiting on you',
    provenance: `Readings from \`${basename(readingsPath)}\`. Nothing here was re-run to build this sheet.`,
  }),
);
