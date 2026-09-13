import { useMemo, useState, type ReactNode } from 'react';
import { Field, SegmentedControl, inputClass, primaryButton } from './Field';
import { Bullets } from './Bullets';
import {
  CATEGORIES,
  type Author,
  type Category,
  type CriteriaElement,
  type DeadlineType,
  type Polarity,
  type Prediction,
  type VerificationMode,
} from '../../domain/types';
import { endOfLocalDay, startOfLocalDay, toLocalDateInput } from '../../domain/prediction';
import type { NewPrediction } from '../../data/repositories/predictionRepo';

/** Dates here are the `YYYY-MM-DD` that date inputs speak. */
export interface PredictionFormValues {
  rawStatement: string;
  normalizedClaim: string;
  authorName: string;
  statementDate: string;
  sourceUrl: string;
  sourceContext: string;
  polarity: Polarity;
  disconfirmingTrigger: string;
  deadlineType: DeadlineType;
  resolutionDate: string;
  windowStart: string;
  windowEnd: string;
  triggerEvent: string;
  triggerExpectedDate: string;
  raceEventB: string;
  staleOutDate: string;
  verificationMode: VerificationMode;
  forceManual: boolean;
  canHappenLate: boolean;
  category: Category;
  stakes: string;
  criteria: string[];
  noCheckBefore: string;
  searchQueries: string[];
}

export const today = (): string => toLocalDateInput(new Date().toISOString());

export function yearsFromToday(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return toLocalDateInput(d.toISOString());
}

export function emptyFormValues(): PredictionFormValues {
  return {
    rawStatement: '',
    normalizedClaim: '',
    authorName: '',
    statementDate: today(),
    sourceUrl: '',
    sourceContext: '',
    polarity: 'positive',
    disconfirmingTrigger: '',
    deadlineType: 'fixed_date',
    resolutionDate: '',
    windowStart: '',
    windowEnd: '',
    triggerEvent: '',
    triggerExpectedDate: '',
    raceEventB: '',
    staleOutDate: yearsFromToday(5),
    verificationMode: 'searchable',
    forceManual: false,
    canHappenLate: false,
    category: 'Other',
    stakes: '',
    criteria: [''],
    noCheckBefore: '',
    searchQueries: [],
  };
}

export function toFormValues(
  p: Prediction,
  criteria: CriteriaElement[],
  authorName: string,
): PredictionFormValues {
  const date = (iso: string | null) => (iso ? toLocalDateInput(iso) : '');
  return {
    rawStatement: p.rawStatement,
    normalizedClaim: p.normalizedClaim === p.rawStatement ? '' : p.normalizedClaim,
    authorName,
    statementDate: date(p.statementDate) || today(),
    sourceUrl: p.sourceUrl ?? '',
    sourceContext: p.sourceContext ?? '',
    polarity: p.polarity,
    disconfirmingTrigger: p.disconfirmingTrigger ?? '',
    deadlineType: p.deadlineType,
    resolutionDate: date(p.resolutionDate),
    windowStart: date(p.windowStart),
    windowEnd: date(p.windowEnd),
    triggerEvent: p.triggerEvent ?? '',
    triggerExpectedDate: date(p.triggerExpectedDate),
    raceEventB: p.raceEventB ?? '',
    staleOutDate: date(p.staleOutDate) || yearsFromToday(5),
    verificationMode: p.verificationMode,
    forceManual: p.forceManual,
    canHappenLate: p.canHappenLate,
    category: p.category,
    stakes: p.stakes ?? '',
    criteria: criteria.length > 0 ? criteria.map((c) => c.text) : [''],
    noCheckBefore: date(p.noCheckBefore),
    searchQueries: p.searchQueries,
  };
}

/** The deadline instant a set of form values implies, or null if not set yet. */
export function deadlineInstant(v: PredictionFormValues): string | null {
  if (v.deadlineType === 'fixed_date') return v.resolutionDate ? endOfLocalDay(v.resolutionDate) : null;
  if (v.deadlineType === 'window') return v.windowEnd ? endOfLocalDay(v.windowEnd) : null;
  return v.triggerExpectedDate ? endOfLocalDay(v.triggerExpectedDate) : null;
}

export function validateFormValues(v: PredictionFormValues): string[] {
  const problems: string[] = [];
  if (!v.rawStatement.trim()) problems.push('The statement is required.');
  if (!v.authorName.trim()) problems.push('Someone said this. Who?');

  const today = toLocalDateInput(new Date().toISOString());
  if (v.statementDate > today) problems.push('It cannot have been said in the future.');

  // A deadline before the claim was made is not a late entry, it is nonsense,
  // and the retroactive flag would quietly paper over it.
  const deadlineDate =
    v.deadlineType === 'fixed_date'
      ? v.resolutionDate
      : v.deadlineType === 'window'
        ? v.windowEnd
        : v.triggerExpectedDate;
  if (deadlineDate && deadlineDate < v.statementDate) {
    problems.push('The deadline falls before the claim was made.');
  }
  if (v.deadlineType === 'window' && v.windowEnd && v.windowEnd < v.statementDate) {
    problems.push('The window closes before the claim was made.');
  }
  if (v.deadlineType === 'event' && v.staleOutDate && v.staleOutDate < v.statementDate) {
    problems.push('The give-up date falls before the claim was made.');
  }
  if (
    v.deadlineType === 'event' &&
    v.triggerExpectedDate &&
    v.staleOutDate &&
    v.staleOutDate < v.triggerExpectedDate
  ) {
    problems.push('It gives up before the event is even expected.');
  }
  if (v.polarity === 'negative' && !v.disconfirmingTrigger.trim())
    problems.push('A negative claim needs the one event that would disprove it.');
  if (v.deadlineType === 'fixed_date' && !v.resolutionDate) problems.push('Pick a deadline.');
  if (v.deadlineType === 'window' && (!v.windowStart || !v.windowEnd))
    problems.push('A window needs both a start and an end.');
  if (v.deadlineType === 'window' && v.windowStart && v.windowEnd && v.windowStart > v.windowEnd)
    problems.push('The window ends before it starts.');
  if (v.deadlineType === 'event' && !v.triggerEvent.trim())
    problems.push('Describe the event that resolves this.');
  if (v.deadlineType === 'event' && !v.staleOutDate)
    problems.push('An event needs a stale-out date or it hangs in the feed forever.');
  if (v.criteria.every((c) => !c.trim()))
    problems.push('Add at least one thing that would settle it.');

  // A criterion is judged at the deadline, so a date inside one that falls
  // after the deadline cannot ever be satisfied in time. This is the whole
  // slippage the app exists to refuse, and it had been arriving from the
  // drafting model: a claim about the 11th came back with criteria written
  // about the 12th, and the check then correctly reported "not yet" forever.
  // Only dates past the deadline are flagged; an earlier one is usually a
  // baseline the criterion is measuring against.
  for (const stray of criteriaDatesPastDeadline(v.criteria, deadlineDate)) {
    problems.push(`A criterion says ${stray}, which is after the deadline. One of them is wrong.`);
  }

  return problems;
}

const ISO_DATE = /\d{4}-\d{2}-\d{2}/g;

export function criteriaDatesPastDeadline(
  criteria: string[],
  deadline: string | null,
): string[] {
  if (!deadline) return [];
  const stray = new Set<string>();
  for (const text of criteria) {
    for (const found of text.match(ISO_DATE) ?? []) {
      if (found > deadline) stray.add(found);
    }
  }
  return [...stray];
}

/** Form values to the shape the repository stores. Author is resolved by the caller. */
export function toNewPrediction(
  v: PredictionFormValues,
  authorId: string,
  extra: Pick<NewPrediction, 'intakeNotes' | 'status'> = {},
): NewPrediction {
  const isEvent = v.deadlineType === 'event';
  return {
    authorId,
    rawStatement: v.rawStatement.trim(),
    normalizedClaim: v.normalizedClaim.trim() || v.rawStatement.trim(),
    polarity: v.polarity,
    disconfirmingTrigger: v.polarity === 'negative' ? v.disconfirmingTrigger.trim() : null,
    statementDate: startOfLocalDay(v.statementDate),
    sourceUrl: v.sourceUrl.trim() || null,
    sourceContext: v.sourceContext.trim() || null,
    deadlineType: v.deadlineType,
    resolutionDate:
      v.deadlineType === 'fixed_date' && v.resolutionDate ? endOfLocalDay(v.resolutionDate) : null,
    windowStart: v.deadlineType === 'window' && v.windowStart ? startOfLocalDay(v.windowStart) : null,
    windowEnd: v.deadlineType === 'window' && v.windowEnd ? endOfLocalDay(v.windowEnd) : null,
    triggerEvent: isEvent ? v.triggerEvent.trim() : null,
    triggerExpectedDate:
      isEvent && v.triggerExpectedDate ? endOfLocalDay(v.triggerExpectedDate) : null,
    raceEventB: isEvent && v.raceEventB.trim() ? v.raceEventB.trim() : null,
    staleOutDate: isEvent ? endOfLocalDay(v.staleOutDate) : null,
    verificationMode: v.verificationMode,
    forceManual: v.forceManual,
    // An event-shaped claim can by definition still occur; only dated ones
    // need the person to say.
    canHappenLate: isEvent ? true : v.canHappenLate,
    searchQueries: v.searchQueries,
    noCheckBefore: v.noCheckBefore ? startOfLocalDay(v.noCheckBefore) : null,
    category: v.category,
    stakes: v.stakes.trim() || null,
    criteria: v.criteria.map((c) => c.trim()).filter(Boolean),
    ...extra,
  };
}

export function PredictionForm({
  initial,
  authors,
  submitLabel,
  onSubmit,
  busy = false,
  banner,
  deadlineNote,
  verifiabilityNote,
  ambiguities = [],
  lockStatement = false,
  onRedraft,
  redrafting = false,
}: {
  initial: PredictionFormValues;
  authors: Author[];
  submitLabel: string;
  onSubmit: (values: PredictionFormValues, isRetroactive: boolean) => void;
  busy?: boolean;
  banner?: ReactNode;
  deadlineNote?: string;
  verifiabilityNote?: string;
  /** Questions the model could not decide. Shown, not gated on. */
  ambiguities?: string[];
  lockStatement?: boolean;
  /**
   * Draft the testable version, questions and criteria again from the
   * statement as it now reads. One model call. Absent on a form that has no
   * model behind it.
   */
  onRedraft?: (rawStatement: string) => void;
  redrafting?: boolean;
}) {
  const [v, setV] = useState<PredictionFormValues>(initial);

  const set = <K extends keyof PredictionFormValues>(key: K, value: PredictionFormValues[K]) =>
    setV((prev) => ({ ...prev, [key]: value }));

  const deadline = deadlineInstant(v);
  const isRetroactive = deadline !== null && new Date(deadline).getTime() < Date.now();

  const problems = useMemo(() => validateFormValues(v), [v]);
  const canRedraft = onRedraft !== undefined && !lockStatement;

  return (
    <div className="space-y-5 px-5 py-5">
      {banner}

      {/* Questions, not a gate. These used to be checkboxes that blocked the
          confirm button until each was ticked, and ticking recorded nothing.
          The questions are the useful part; the way to answer one is to
          sharpen the fields, or the statement itself and redraft. */}
      {ambiguities.length > 0 && (
        <section className="rounded border border-partial/40 bg-partial/5 p-3">
          <h2 className="text-[11px] font-semibold tracking-wide text-partial uppercase">
            Worth settling first
          </h2>
          <p className="mt-1 text-[12px] text-ink-faint">
            The model could not decide these from what was said. Deciding after you know the
            answer is how timeframes slip.
          </p>
          <ul className="mt-2 space-y-1.5">
            {ambiguities.map((question) => (
              <li key={question} className="text-[14px] text-ink-dim">
                {question}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-ink-faint">
            {canRedraft
              ? 'Answer by editing the fields below, or sharpen the wording of what was said and redraft; the testable version, these questions and the criteria are drawn again from it.'
              : 'Answer by editing the fields below.'}
          </p>
        </section>
      )}

      <Field
        label="What was said"
        hint={
          lockStatement
            ? 'Verbatim. This is never edited.'
            : 'Editable until it goes on the record. After that it is verbatim and never edited.'
        }
      >
        <textarea
          value={v.rawStatement}
          onChange={(e) => set('rawStatement', e.target.value)}
          rows={3}
          readOnly={lockStatement}
          placeholder="Mark my words, ..."
          className={`${inputClass} font-display text-[17px] ${lockStatement ? 'text-ink-dim' : ''}`}
        />
        {canRedraft && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              onClick={() => onRedraft(v.rawStatement)}
              disabled={redrafting || busy || v.rawStatement.trim().length === 0}
              className="rounded border border-rule px-3 py-1.5 text-[13px] text-ink-dim disabled:opacity-40"
            >
              {redrafting ? 'Redrafting...' : 'Redraft from this'}
            </button>
            <span className="text-[12px] text-ink-faint">
              Not specific enough? Sharpen the wording above, then redraft. The fields below are
              drawn again from it. One model call.
            </span>
          </div>
        )}
      </Field>

      <Field
        label="The testable version"
        hint="Leave blank to track exactly what was said."
      >
        <textarea
          value={v.normalizedClaim}
          onChange={(e) => set('normalizedClaim', e.target.value)}
          rows={2}
          placeholder="The St. Louis Cardinals win the 2026 World Series."
          className={inputClass}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Who said it">
          <input
            list="author-names"
            value={v.authorName}
            onChange={(e) => set('authorName', e.target.value)}
            placeholder="Popops"
            className={inputClass}
          />
          <datalist id="author-names">
            {authors.map((a) => (
              <option key={a.id} value={a.displayName} />
            ))}
          </datalist>
        </Field>
        <Field label="When">
          <input
            type="date"
            value={v.statementDate}
            onChange={(e) => set('statementDate', e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <Field group label="Where" hint="A link, or just where you heard it.">
        <input
          value={v.sourceUrl}
          onChange={(e) => set('sourceUrl', e.target.value)}
          placeholder="https://..."
          inputMode="url"
          className={inputClass}
        />
        <input
          value={v.sourceContext}
          onChange={(e) => set('sourceContext', e.target.value)}
          placeholder="Instagram story, said at dinner, CNN segment"
          className={`${inputClass} mt-2`}
        />
      </Field>

      <Field group label="Shape of the claim">
        <SegmentedControl
          ariaLabel="Polarity"
          value={v.polarity}
          onChange={(value) => set('polarity', value)}
          options={[
            { value: 'positive', label: 'Will happen' },
            { value: 'negative', label: 'Will not happen' },
          ]}
        />
      </Field>

      {v.polarity === 'negative' && (
        <Field
          label="What would disprove it"
          hint="You cannot search for a non-event. You search for the thing that kills the claim."
        >
          <input
            value={v.disconfirmingTrigger}
            onChange={(e) => set('disconfirmingTrigger', e.target.value)}
            placeholder="An AI-weighted index falls 30% from its peak"
            className={inputClass}
          />
        </Field>
      )}

      <Field group label="Deadline" hint={deadlineNote}>
        <SegmentedControl
          ariaLabel="Deadline type"
          value={v.deadlineType}
          onChange={(value) => set('deadlineType', value)}
          options={[
            { value: 'fixed_date', label: 'By a date' },
            { value: 'window', label: 'In a window' },
            { value: 'event', label: 'When X happens' },
          ]}
        />
      </Field>

      {v.deadlineType === 'fixed_date' && (
        <Field label="Resolves by">
          <input
            type="date"
            value={v.resolutionDate}
            onChange={(e) => set('resolutionDate', e.target.value)}
            className={inputClass}
          />
        </Field>
      )}

      {v.deadlineType === 'window' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Window opens">
            <input
              type="date"
              value={v.windowStart}
              onChange={(e) => set('windowStart', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Window closes">
            <input
              type="date"
              value={v.windowEnd}
              onChange={(e) => set('windowEnd', e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      )}

      {v.deadlineType === 'event' && (
        <>
          <Field label="Resolves when">
            <input
              value={v.triggerEvent}
              onChange={(e) => set('triggerEvent', e.target.value)}
              placeholder="Avengers: Doomsday releases in theaters"
              className={inputClass}
            />
          </Field>
          <Field
            label="Before (optional)"
            hint="Fill this in for a race. Whichever event lands first decides it."
          >
            <input
              value={v.raceEventB}
              onChange={(e) => set('raceEventB', e.target.value)}
              placeholder="the studio cancels the film"
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Expected around" hint="Cadence hint only.">
              <input
                type="date"
                value={v.triggerExpectedDate}
                onChange={(e) => set('triggerExpectedDate', e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Give up after" hint="Auto-voids on this date.">
              <input
                type="date"
                value={v.staleOutDate}
                onChange={(e) => set('staleOutDate', e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        </>
      )}

      <Field
        group
        label="Who settles it"
        hint={
          verifiabilityNote ??
          (v.verificationMode === 'manual'
            ? 'Nothing gets searched. You get asked on the deadline.'
            : 'Checked against the web once verification ships.')
        }
      >
        <SegmentedControl
          ariaLabel="Verification mode"
          value={v.verificationMode}
          onChange={(value) => set('verificationMode', value)}
          options={[
            { value: 'searchable', label: 'Searchable' },
            { value: 'manual', label: 'You decide' },
          ]}
        />
      </Field>

      {v.verificationMode === 'searchable' && (
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={v.forceManual}
            onChange={(e) => set('forceManual', e.target.checked)}
            className="checkbox mt-0.5"
          />
          <span className="text-[13px] text-ink-dim">
            Never auto-resolve this one. Show me the evidence and let me call it.
          </span>
        </label>
      )}

      {v.deadlineType !== 'event' && (
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={v.canHappenLate}
            onChange={(e) => set('canHappenLate', e.target.checked)}
            className="checkbox mt-0.5"
          />
          <span className="text-[13px] text-ink-dim">
            It could still happen after the deadline. Keep watching for a late hit; a miss stays
            a miss, but earns the badge.
          </span>
        </label>
      )}

      <Field group label="What would settle it" hint="Each line is checked independently.">
        <div className="space-y-2">
          {v.criteria.map((value, index) => (
            <div key={index} className="flex items-start gap-2">
              {/* A textarea, because a criterion is a sentence. In a one-line
                  input the sentence scrolled out of sight as it was typed, and
                  a criterion you cannot read back is one you cannot check. */}
              <textarea
                value={value}
                onChange={(e) =>
                  set(
                    'criteria',
                    v.criteria.map((c, i) => (i === index ? e.target.value : c)),
                  )
                }
                rows={2}
                placeholder={index === 0 ? 'The Cardinals win the 2026 World Series' : 'And...'}
                className={`${inputClass} resize-y`}
              />
              {v.criteria.length > 1 && (
                <button
                  type="button"
                  aria-label="Remove this criterion"
                  onClick={() =>
                    set(
                      'criteria',
                      v.criteria.filter((_, i) => i !== index),
                    )
                  }
                  className="min-h-11 shrink-0 rounded border border-rule px-3 text-ink-faint"
                >
                  −
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => set('criteria', [...v.criteria, ''])}
            className="rounded border border-rule min-h-11 px-4 text-[13px] text-ink-dim"
          >
            Add another
          </button>
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <select
            value={v.category}
            onChange={(e) => set('category', e.target.value as Category)}
            className={inputClass}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Stakes">
          <input
            value={v.stakes}
            onChange={(e) => set('stakes', e.target.value)}
            placeholder="$20, a beer"
            className={inputClass}
          />
        </Field>
      </div>

      {isRetroactive && (
        <p className="rounded border border-partial/40 bg-partial/5 px-3 py-2.5 text-[13px] text-partial">
          That deadline is already past. This will be filed as entered after the fact and kept out
          of hit-rate math.
        </p>
      )}

      {problems.length > 0 && (
        <Bullets items={problems} className="text-[13px] text-ink-faint" />
      )}

      <button
        type="button"
        onClick={() => onSubmit(v, isRetroactive)}
        disabled={problems.length > 0 || busy}
        className={`${primaryButton} w-full py-3 font-display text-[17px]`}
      >
        {busy ? 'Working...' : submitLabel}
      </button>
    </div>
  );
}
