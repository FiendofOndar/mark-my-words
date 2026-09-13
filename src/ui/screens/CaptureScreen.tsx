import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { Field, inputClass, primaryButton, secondaryButton } from '../components/Field';
import { Busy } from '../components/Spinner';
import { today } from '../components/PredictionForm';
import {
  useAuthors,
  useCreatePrediction,
  useFindOrCreateAuthor,
  useStructureStatement,
} from '../queries';
import { bareDraft, structuredToDraft } from '../../verification/toPrediction';
import { loadVerifierConfig } from '../../lib/keyStore';
import { DEFAULT_GEMINI_MODEL } from '../../verification/GeminiVerifier';
import { VerifierError } from '../../verification/types';
import { startOfLocalDay } from '../../domain/prediction';

/**
 * One screen, one job: get the quote and who said it out of your head and into
 * the app. Everything else is the review card's problem.
 */
export function CaptureScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const shared = location.state as { text?: string; url?: string | null } | null;
  const { data: authors = [] } = useAuthors();
  const config = loadVerifierConfig();

  const findOrCreateAuthor = useFindOrCreateAuthor();
  const createPrediction = useCreatePrediction();
  const structure = useStructureStatement();

  const [rawStatement, setRawStatement] = useState(shared?.text ?? '');
  const [authorName, setAuthorName] = useState('');
  const [statementDate, setStatementDate] = useState(today);
  const [sourceUrl, setSourceUrl] = useState(shared?.url ?? '');
  const [sourceContext, setSourceContext] = useState('');
  const [error, setError] = useState<string | null>(null);

  // A share arriving while this screen is already mounted still has to land.
  useEffect(() => {
    if (shared?.text) setRawStatement(shared.text);
    if (shared?.url) setSourceUrl(shared.url);
  }, [shared?.text, shared?.url]);

  const ready = rawStatement.trim().length > 0 && authorName.trim().length > 0;

  // A dead button with no explanation is the worst state this screen has. Both
  // actions need the same two fields, so say which one is still empty rather
  // than leaving someone to work it out by elimination.
  const missing =
    rawStatement.trim().length === 0 && authorName.trim().length === 0
      ? 'Add what was said and who said it.'
      : rawStatement.trim().length === 0
        ? 'Add what was said.'
        : authorName.trim().length === 0
          ? 'Add who said it.'
          : null;
  const started = rawStatement.trim().length > 0 || authorName.trim().length > 0;
  const usingModel = config.provider === 'gemini' && config.apiKey.trim().length > 0;
  const busy = structure.isPending || createPrediction.isPending;

  const base = () => ({
    rawStatement: rawStatement.trim(),
    statementDate: startOfLocalDay(statementDate),
    sourceUrl: sourceUrl.trim() || null,
    sourceContext: sourceContext.trim() || null,
  });

  const withAuthor = async () => {
    const author = await findOrCreateAuthor.mutateAsync({ displayName: authorName.trim() });
    return author.id;
  };

  const draftWithAi = async () => {
    setError(null);
    try {
      const authorId = await withAuthor();
      const result = await structure.mutateAsync({
        rawStatement: rawStatement.trim(),
        sourceUrl: sourceUrl.trim() || null,
        sourceContext: sourceContext.trim() || null,
        today: statementDate,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      const prediction = await createPrediction.mutateAsync(
        structuredToDraft(result, { authorId, ...base() }),
      );
      navigate(`/draft/${prediction.id}`, { replace: true });
    } catch (err) {
      const detail = err instanceof VerifierError ? err.detail : undefined;
      setError(`${(err as Error).message}${detail ? ` (${detail})` : ''}`);
    }
  };

  const draftManually = async () => {
    setError(null);
    try {
      const authorId = await withAuthor();
      const prediction = await createPrediction.mutateAsync(bareDraft({ authorId, ...base() }));
      navigate(`/draft/${prediction.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Screen title="Catch it" subtitle="Get it down now, sharpen it next" back>
      <div className="space-y-5 px-5 py-5">
        <Field label="What was said" hint="Verbatim. This is never edited later.">
          <textarea
            value={rawStatement}
            onChange={(e) => setRawStatement(e.target.value)}
            rows={4}
            autoFocus
            placeholder="Mark my words, ..."
            className={`${inputClass} font-quote text-[19px] font-semibold`}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Who said it">
            <input
              list="capture-authors"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="Popops"
              className={inputClass}
            />
            <datalist id="capture-authors">
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

        <Field group label="Where" hint="Optional. A link, or just where you heard it.">
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

        {error && (
          <div className="rounded border border-miss/50 bg-miss/5 px-3 py-2.5">
            <p className="text-[13px] text-miss">{error}</p>
            <p className="mt-1 text-[12px] text-ink-faint">
              Nothing was lost. Fill it in yourself and keep the capture.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <button
            type="button"
            onClick={draftWithAi}
            disabled={!ready || busy}
            className={`${primaryButton} w-full py-3 text-[17px]`}
          >
            {structure.isPending ? <Busy>Reading it...</Busy> : 'Draft the criteria'}
          </button>
          {/* Tinted only once one of the two fields is filled. On an untouched
              form the hint is just orientation, and colouring it is scolding
              someone for not having typed yet. */}
          <p
            className={`text-center text-[12px] ${
              missing && started ? 'text-attention' : 'text-prose-faint'
            }`}
          >
            {missing ??
              (usingModel
                ? `Using ${config.model || DEFAULT_GEMINI_MODEL}. You confirm everything before the clock starts.`
                : 'No API key set, so this falls back to offline pattern matching. Add a key in Settings for a real reading.')}
          </p>

          <button
            type="button"
            onClick={draftManually}
            disabled={!ready || busy}
            className={`${secondaryButton} w-full py-2.5 text-[15px]`}
          >
            Fill it in myself
          </button>
        </div>
      </div>
    </Screen>
  );
}
