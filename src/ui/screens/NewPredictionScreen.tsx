import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { Field, SegmentedControl, inputClass } from '../components/Field';
import { useAuthors, useCreatePrediction, useFindOrCreateAuthor } from '../queries';
import { CATEGORIES, type Category, type DeadlineType, type Polarity, type VerificationMode } from '../../domain/types';
import { endOfLocalDay, startOfLocalDay, toLocalDateInput } from '../../domain/prediction';

const today = () => toLocalDateInput(new Date().toISOString());

function yearsFromToday(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return toLocalDateInput(d.toISOString());
}

/**
 * Manual entry. Phase 0.2 replaces most of this with an AI-drafted review card;
 * the fields it writes are the same, which is why this form is the shape it is.
 */
export function NewPredictionScreen() {
  const navigate = useNavigate();
  const { data: authors = [] } = useAuthors();
  const createPrediction = useCreatePrediction();
  const findOrCreateAuthor = useFindOrCreateAuthor();

  const [rawStatement, setRawStatement] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [statementDate, setStatementDate] = useState(today);
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceContext, setSourceContext] = useState('');

  const [polarity, setPolarity] = useState<Polarity>('positive');
  const [disconfirmingTrigger, setDisconfirmingTrigger] = useState('');

  const [deadlineType, setDeadlineType] = useState<DeadlineType>('fixed_date');
  const [resolutionDate, setResolutionDate] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [triggerEvent, setTriggerEvent] = useState('');
  const [triggerExpectedDate, setTriggerExpectedDate] = useState('');
  const [raceEventB, setRaceEventB] = useState('');
  const [staleOutDate, setStaleOutDate] = useState(() => yearsFromToday(5));

  const [verificationMode, setVerificationMode] = useState<VerificationMode>('searchable');
  const [forceManual, setForceManual] = useState(false);
  const [category, setCategory] = useState<Category>('Other');
  const [stakes, setStakes] = useState('');
  const [criteria, setCriteria] = useState<string[]>(['']);

  const deadlineIso = useMemo(() => {
    if (deadlineType === 'fixed_date') return resolutionDate ? endOfLocalDay(resolutionDate) : null;
    if (deadlineType === 'window') return windowEnd ? endOfLocalDay(windowEnd) : null;
    return triggerExpectedDate ? endOfLocalDay(triggerExpectedDate) : null;
  }, [deadlineType, resolutionDate, windowEnd, triggerExpectedDate]);

  const isRetroactive = deadlineIso !== null && new Date(deadlineIso).getTime() < Date.now();

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!rawStatement.trim()) list.push('The statement is required.');
    if (!authorName.trim()) list.push('Someone said this. Who?');
    if (polarity === 'negative' && !disconfirmingTrigger.trim())
      list.push('A negative claim needs the one event that would disprove it.');
    if (deadlineType === 'fixed_date' && !resolutionDate) list.push('Pick a deadline.');
    if (deadlineType === 'window' && (!windowStart || !windowEnd))
      list.push('A window needs both a start and an end.');
    if (deadlineType === 'window' && windowStart && windowEnd && windowStart > windowEnd)
      list.push('The window ends before it starts.');
    if (deadlineType === 'event' && !triggerEvent.trim())
      list.push('Describe the event that resolves this.');
    if (deadlineType === 'event' && !staleOutDate)
      list.push('An event needs a stale-out date or it hangs in the feed forever.');
    if (criteria.every((c) => !c.trim())) list.push('Add at least one thing that would settle it.');
    return list;
  }, [
    rawStatement, authorName, polarity, disconfirmingTrigger, deadlineType,
    resolutionDate, windowStart, windowEnd, triggerEvent, staleOutDate, criteria,
  ]);

  const submit = () => {
    if (problems.length > 0) return;
    const author = findOrCreateAuthor.mutate(
      { displayName: authorName.trim() },
      {
        onSuccess: (created) => {
          createPrediction.mutate(
            {
              authorId: created.id,
              rawStatement: rawStatement.trim(),
              polarity,
              disconfirmingTrigger: polarity === 'negative' ? disconfirmingTrigger.trim() : null,
              statementDate: startOfLocalDay(statementDate),
              sourceUrl: sourceUrl.trim() || null,
              sourceContext: sourceContext.trim() || null,
              deadlineType,
              resolutionDate:
                deadlineType === 'fixed_date' && resolutionDate ? endOfLocalDay(resolutionDate) : null,
              windowStart:
                deadlineType === 'window' && windowStart ? startOfLocalDay(windowStart) : null,
              windowEnd: deadlineType === 'window' && windowEnd ? endOfLocalDay(windowEnd) : null,
              triggerEvent: deadlineType === 'event' ? triggerEvent.trim() : null,
              triggerExpectedDate:
                deadlineType === 'event' && triggerExpectedDate
                  ? endOfLocalDay(triggerExpectedDate)
                  : null,
              raceEventB: deadlineType === 'event' && raceEventB.trim() ? raceEventB.trim() : null,
              staleOutDate: deadlineType === 'event' ? endOfLocalDay(staleOutDate) : null,
              verificationMode,
              forceManual,
              category,
              stakes: stakes.trim() || null,
              isRetroactive,
              criteria: criteria.map((c) => c.trim()).filter(Boolean),
            },
            { onSuccess: (prediction) => navigate(`/p/${prediction.id}`, { replace: true }) },
          );
        },
      },
    );
    return author;
  };

  return (
    <Screen title="On the record" back>
      <div className="space-y-5 px-5 py-5">
        <Field label="What was said" hint="Verbatim. This is never edited later.">
          <textarea
            value={rawStatement}
            onChange={(e) => setRawStatement(e.target.value)}
            rows={3}
            placeholder="Mark my words, ..."
            className={`${inputClass} font-display text-[17px]`}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Who said it">
            <input
              list="author-names"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
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
              value={statementDate}
              onChange={(e) => setStatementDate(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <Field group label="Where" hint="A link, or just where you heard it.">
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://..."
            inputMode="url"
            className={inputClass}
          />
          <input
            value={sourceContext}
            onChange={(e) => setSourceContext(e.target.value)}
            placeholder="Instagram story, said at dinner, CNN segment"
            className={`${inputClass} mt-2`}
          />
        </Field>

        <Field group label="Shape of the claim">
          <SegmentedControl
            ariaLabel="Polarity"
            value={polarity}
            onChange={setPolarity}
            options={[
              { value: 'positive', label: 'Will happen' },
              { value: 'negative', label: 'Will not happen' },
            ]}
          />
        </Field>

        {polarity === 'negative' && (
          <Field
            label="What would disprove it"
            hint="You cannot search for a non-event. You search for the thing that kills the claim."
          >
            <input
              value={disconfirmingTrigger}
              onChange={(e) => setDisconfirmingTrigger(e.target.value)}
              placeholder="An AI-weighted index falls 30% from its peak"
              className={inputClass}
            />
          </Field>
        )}

        <Field group label="Deadline">
          <SegmentedControl
            ariaLabel="Deadline type"
            value={deadlineType}
            onChange={setDeadlineType}
            options={[
              { value: 'fixed_date', label: 'By a date' },
              { value: 'window', label: 'In a window' },
              { value: 'event', label: 'When X happens' },
            ]}
          />
        </Field>

        {deadlineType === 'fixed_date' && (
          <Field label="Resolves by">
            <input
              type="date"
              value={resolutionDate}
              onChange={(e) => setResolutionDate(e.target.value)}
              className={inputClass}
            />
          </Field>
        )}

        {deadlineType === 'window' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Window opens">
              <input
                type="date"
                value={windowStart}
                onChange={(e) => setWindowStart(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Window closes">
              <input
                type="date"
                value={windowEnd}
                onChange={(e) => setWindowEnd(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        )}

        {deadlineType === 'event' && (
          <>
            <Field label="Resolves when">
              <input
                value={triggerEvent}
                onChange={(e) => setTriggerEvent(e.target.value)}
                placeholder="Avengers: Doomsday releases in theaters"
                className={inputClass}
              />
            </Field>
            <Field
              label="Before (optional)"
              hint="Fill this in for a race. Whichever event lands first decides it."
            >
              <input
                value={raceEventB}
                onChange={(e) => setRaceEventB(e.target.value)}
                placeholder="the studio cancels the film"
                className={inputClass}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Expected around" hint="Cadence hint only.">
                <input
                  type="date"
                  value={triggerExpectedDate}
                  onChange={(e) => setTriggerExpectedDate(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Give up after" hint="Auto-voids on this date.">
                <input
                  type="date"
                  value={staleOutDate}
                  onChange={(e) => setStaleOutDate(e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
          </>
        )}

        <Field group
          label="Who settles it"
          hint={
            verificationMode === 'manual'
              ? 'Nothing gets searched. You get asked on the deadline.'
              : 'Checked against the web once verification ships.'
          }
        >
          <SegmentedControl
            ariaLabel="Verification mode"
            value={verificationMode}
            onChange={setVerificationMode}
            options={[
              { value: 'searchable', label: 'Searchable' },
              { value: 'manual', label: 'You decide' },
            ]}
          />
        </Field>

        {verificationMode === 'searchable' && (
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={forceManual}
              onChange={(e) => setForceManual(e.target.checked)}
              className="mt-1"
            />
            <span className="text-[13px] text-ink-dim">
              Never auto-resolve this one. Show me the evidence and let me call it.
            </span>
          </label>
        )}

        <Field group label="What would settle it" hint="Each line is checked independently.">
          <div className="space-y-2">
            {criteria.map((value, index) => (
              <div key={index} className="flex gap-2">
                <input
                  value={value}
                  onChange={(e) =>
                    setCriteria((prev) => prev.map((c, i) => (i === index ? e.target.value : c)))
                  }
                  placeholder={index === 0 ? 'The Cardinals win the 2026 World Series' : 'And...'}
                  className={inputClass}
                />
                {criteria.length > 1 && (
                  <button
                    type="button"
                    aria-label="Remove this criterion"
                    onClick={() => setCriteria((prev) => prev.filter((_, i) => i !== index))}
                    className="shrink-0 rounded border border-rule px-3 text-ink-faint"
                  >
                    −
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setCriteria((prev) => [...prev, ''])}
              className="rounded border border-rule px-3 py-1.5 text-[13px] text-ink-dim"
            >
              Add another
            </button>
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
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
              value={stakes}
              onChange={(e) => setStakes(e.target.value)}
              placeholder="$20, a beer"
              className={inputClass}
            />
          </Field>
        </div>

        {isRetroactive && (
          <p className="rounded border border-partial/40 bg-partial/5 px-3 py-2.5 text-[13px] text-partial">
            That deadline is already past. This will be filed as entered after the fact and kept
            out of hit-rate math.
          </p>
        )}

        {problems.length > 0 && (
          <ul className="space-y-1 text-[13px] text-ink-faint">
            {problems.map((problem) => (
              <li key={problem}>· {problem}</li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={problems.length > 0 || createPrediction.isPending}
          className="w-full rounded bg-ink py-3 font-display text-[17px] text-ground disabled:opacity-40"
        >
          Put it on the record
        </button>
      </div>
    </Screen>
  );
}
