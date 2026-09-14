import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { Field, inputClass, primaryButton, secondaryButton } from '../components/Field';
import { Busy } from '../components/Spinner';
import { today } from '../components/PredictionForm';
import {
  useAuthors,
  useCreatePrediction,
  useExtractPost,
  useFindOrCreateAuthor,
  useStructureStatement,
} from '../queries';
import { keepScreenshot, takeSharedImage } from '../../platform/sharedImage';
import { recordExtraction } from '../../lib/shareLog';
import { fetchPostText, postTextSupported } from '../../capture/postText';
import { archiveHttp } from '../../capture/http';
import { isHostileHost } from '../../capture/archive';
import { bareDraft, structuredToDraft } from '../../verification/toPrediction';
import { loadVerifierConfig } from '../../lib/keyStore';
import { DEFAULT_GEMINI_MODEL } from '../../verification/GeminiVerifier';
import { VerifierError, type ExtractedPost } from '../../verification/types';
import { startOfLocalDay } from '../../domain/prediction';

/**
 * One screen, one job: get the quote and who said it out of your head and into
 * the app. Everything else is the review card's problem.
 */
/**
 * The statement date sets where the claim's period starts and whether it
 * counts as retroactive, so a screenshot that yielded no full date must not
 * look as though it did. Today is the default either way; this says so.
 */
export function dateNote(post: Pick<ExtractedPost, 'postedOn' | 'postedHint'>): string | null {
  if (post.postedOn) return null;
  if (post.postedHint) {
    return `The post shows "${post.postedHint}" rather than a full date, so When is set to today. Change it if the post is older.`;
  }
  return 'No date was visible in the screenshot, so When is set to today. Change it if the post is older.';
}

export function CaptureScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const shared = location.state as {
    text?: string;
    url?: string | null;
    imageToken?: string | null;
    note?: string | null;
  } | null;
  const { data: authors = [] } = useAuthors();
  const config = loadVerifierConfig();

  const findOrCreateAuthor = useFindOrCreateAuthor();
  const createPrediction = useCreatePrediction();
  const structure = useStructureStatement();
  const extract = useExtractPost();

  const [rawStatement, setRawStatement] = useState(shared?.text ?? '');
  const [authorName, setAuthorName] = useState('');
  const [statementDate, setStatementDate] = useState(today);
  const [sourceUrl, setSourceUrl] = useState(shared?.url ?? '');
  const [sourceContext, setSourceContext] = useState('');
  const [screenshotPath, setScreenshotPath] = useState<string | null>(null);
  /** What the app is doing with the share before the form is usable. */
  const [reading, setReading] = useState<'screenshot' | 'post' | null>(null);
  /** Why the fields are not filled, when a share could not fill them. */
  const [readNote, setReadNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A share arriving while this screen is already mounted still has to land.
  useEffect(() => {
    if (shared?.text) setRawStatement(shared.text);
    if (shared?.url) setSourceUrl(shared.url);
    if (shared?.note) setReadNote(shared.note);
  }, [shared?.text, shared?.url, shared?.note]);

  /**
   * What a share can fill in for itself.
   *
   * A screenshot is read by the model for the post's words, the handle and
   * the date, and kept as the source. A link from X or Reddit is asked for
   * the post's text. A link from a platform that gives nothing (Instagram,
   * TikTok, Threads) gets a note saying to screenshot the post instead;
   * before this it opened an empty form with no explanation, which read as
   * the feature not working. Each share is handled once, keyed on what it
   * carried, because the extraction is a paid call and StrictMode mounts
   * twice.
   */
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const key = shared?.imageToken ?? (shared?.url && !shared.text ? shared.url : null);
    if (!key || handled.current === key) return;
    handled.current = key;

    const run = async () => {
      setReadNote(null);
      setError(null);
      if (shared?.imageToken) {
        // A share that lands while this screen is already open is a new
        // post; nothing from the last one may survive into its form. Two
        // Reddit posts with their authors plainly on screen once came in
        // as "u/[deleted]", the author of the share before them.
        setRawStatement('');
        setAuthorName('');
        setStatementDate(today());
        setSourceUrl('');
        setSourceContext('');
        setScreenshotPath(null);
        setReading('screenshot');
        try {
          const image = takeSharedImage(shared.imageToken);
          const [result, path] = await Promise.all([
            extract.mutateAsync({ imageBase64: image.data, mimeType: image.mimeType, today: today() }),
            keepScreenshot(image),
          ]);
          recordExtraction(result.rawText);
          setScreenshotPath(path);
          const post = result.value;
          if (post.isPrediction && post.statement) {
            setRawStatement(post.statement);
            if (post.author) setAuthorName(post.author);
            if (post.postedOn) setStatementDate(post.postedOn);
            setSourceContext(post.platform ? `Screenshot of a post on ${post.platform}` : 'Screenshot');
            const notes = [post.note, dateNote(post)].filter((n): n is string => n !== null);
            if (notes.length > 0) setReadNote(notes.join(' '));
          } else {
            setSourceContext('Screenshot');
            setReadNote(
              post.note ??
                'The model did not find a prediction in that screenshot. Type what was said, and the screenshot stays attached as the source.',
            );
          }
        } catch (err) {
          const detail = err instanceof VerifierError ? err.detail : undefined;
          setError(`Could not read the screenshot: ${(err as Error).message}${detail ? ` (${detail})` : ''}`);
        } finally {
          setReading(null);
        }
        return;
      }

      const url = shared?.url ?? '';
      if (postTextSupported(url)) {
        setReading('post');
        const post = await fetchPostText(url, archiveHttp);
        setReading(null);
        if (post) {
          setRawStatement(post.text);
          if (post.author) setAuthorName(post.author);
          if (post.postedOn) setStatementDate(post.postedOn);
          setSourceContext(postTextSupported(url) === 'x' ? 'X post' : 'Reddit post');
          return;
        }
        setReadNote(
          'The post\'s words did not come with the link. Screenshot the post and share the picture instead; the app reads it.',
        );
        return;
      }
      if (isHostileHost(url)) {
        setReadNote(
          'This link came without the post\'s words, and this platform does not give them out. Screenshot the post and share the picture instead; the app reads it.',
        );
      }
    };
    void run();
    // The share payload is the trigger; the mutation object is stable enough
    // and listing it would re-run a paid call on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared?.imageToken, shared?.url, shared?.text]);

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
    screenshotPath,
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
        {reading && (
          <div className="glass p-3 text-[13px] text-ink-dim">
            <Busy>{reading === 'screenshot' ? 'Reading the screenshot...' : 'Fetching the post...'}</Busy>
          </div>
        )}
        {readNote && !reading && (
          <div className="rounded-lg border border-attention/50 bg-attention/5 px-3 py-2.5">
            <p className="text-[13px] leading-relaxed text-attention">{readNote}</p>
          </div>
        )}

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
            disabled={!ready || busy || reading !== null}
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
