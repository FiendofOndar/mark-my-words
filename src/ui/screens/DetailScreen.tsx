import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { Icon } from '../components/Icon';
import { primaryButton } from '../components/Field';
import { Stamp, LateBadge, Pill, STATUS_TONE } from '../components/Stamp';
import { TrendMark } from '../components/TrendMark';
import { ExternalLink } from '../components/ExternalLink';
import {
  useAmendCriterion,
  useAmendPrediction,
  useApproveVerdict,
  useCheckLog,
  useDeletePrediction,
  usePrediction,
  usePull,
  useQueuedVerdicts,
  useRejectVerdict,
  useResolveManually,
  useSnoozePrompt,
  useUpdatePrediction,
} from '../queries';
import { CheckLog, describeSources } from '../components/CheckLog';
import { ReceiptCard } from '../../receipts/ReceiptCard';
import { useReceipt } from '../../receipts/useReceipt';
import { describeProgress } from '../../verification/runPull';
import { ConfirmDialog } from '../components/Modal';
import { Busy } from '../components/Spinner';
import {
  describeDeadline,
  formatCountdown,
  formatDate,
  formatLateBadge,
  STATUS_LABEL,
} from '../../domain/format';
import {
  daysUntilDeadline,
  endOfLocalDay,
  isResolved,
  checkedButUnsettled,
  isPastDeadline,
  isUnderLateWatch,
  markLateHit,
  reopen,
} from '../../domain/prediction';
import type { Evidence, PredictionStatus } from '../../domain/types';

const VERDICTS: PredictionStatus[] = ['hit', 'miss', 'partial', 'ambiguous', 'void'];

export function DetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data, isLoading } = usePrediction(id);

  const { data: log = [] } = useCheckLog(id);
  const { data: queued } = useQueuedVerdicts();
  const pull = usePull();
  const approve = useApproveVerdict();
  const reject = useRejectVerdict();
  const resolveManually = useResolveManually();
  const update = useUpdatePrediction();
  const snooze = useSnoozePrompt();
  const receipt = useReceipt();
  const amend = useAmendPrediction();
  const amendCriterion = useAmendCriterion();
  const remove = useDeletePrediction();

  const [showResolve, setShowResolve] = useState(false);
  // Reached with ?amend=1 from the feed's press-and-hold menu.
  const [amending, setAmending] = useState(params.get('amend') === '1');
  const [amendingCriterion, setAmendingCriterion] = useState<string | null>(null);

  /**
   * Both of these panels open underneath the action buttons, which sit at the
   * bottom of a long screen, so tapping "Resolve manually" looked like it did
   * nothing at all: the panel it opened was below the fold.
   */
  const revealed = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (showResolve || amending) {
      // 'end', not 'nearest': nearest scrolls the minimum, which left the last
      // verdict button half off the bottom of the screen.
      revealed.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [showResolve, amending]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [lateDate, setLateDate] = useState('');

  if (isLoading) return <Screen title="..." back><div /></Screen>;
  if (!data) {
    return (
      <Screen title="Not found" back>
        <p className="px-4 py-10 text-center text-ink-dim">
          That prediction is not on the record.
        </p>
      </Screen>
    );
  }

  const { prediction: p, author, criteria, amendments } = data;
  const late = formatLateBadge(p);
  const queuedVerdict = queued?.get(p.id) ?? null;
  // The in-app twin of the deadline notification's inline buttons, which work
  // everywhere even where the platform cannot put buttons on a notification.
  const overdueDays = daysUntilDeadline(p);
  const countdownTone =
    p.status === 'draft'
      ? 'text-draft'
      : overdueDays !== null && overdueDays < 0
        ? 'text-miss'
        : overdueDays !== null && overdueDays <= 7
          ? 'text-attention'
          : 'text-ink';

  /**
   * The check that settled this, and the single source worth linking from it.
   *
   * Preferring a link the app saw answer: sending someone to a dead address
   * from a verdict that says it was checked is the worst version of this.
   * Highest tier wins among equals.
   */
  const settledBy = isResolved(p.status)
    ? log.find((entry) => entry.check.outcome === 'auto_resolved') ?? null
    : null;
  const settledSource = settledBy ? bestSource(settledBy.evidence) : null;
  const queuedEvidence =
    log.find((entry) => entry.check.id === queuedVerdict?.id)?.evidence ?? [];

  // Either nothing can search it, or something did and could not settle it.
  // Both end in the same place: the answer has to come from the person.
  //
  // Not when a verdict is already queued, though. That card asks the same
  // question with an answer attached, and stacking a bare "Did it happen?
  // Yes / No" above it makes the screen ask twice and contradict itself about
  // whether the app found anything. Answer the verdict or reject it; rejecting
  // brings this back.
  const searchedInVain = checkedButUnsettled(p);
  const awaitingAnswer =
    p.status === 'open' &&
    queuedVerdict === null &&
    ((p.verificationMode === 'manual' && isPastDeadline(p)) || searchedInVain);

  const onResolve = (verdict: PredictionStatus) => {
    resolveManually.mutate({ id: p.id, verdict });
    setShowResolve(false);
  };

  return (
    <Screen
      title={
        // hover:underline is the only thing that said this was a link, and a
        // phone has no hover. The chevron says it, and the vertical padding
        // makes the 20px line reach the header's 44px band.
        <Link
          to={`/author/${author.id}`}
          className="-my-2 flex min-w-0 items-center gap-1.5 py-2 active:opacity-60"
        >
          <span className="truncate">{author.displayName}</span>
          <Icon name="chevron" size={16} className="shrink-0 text-ink-faint" />
        </Link>
      }
      subtitle={author.handle ?? undefined}
      back
    >
      {/* The quote carries the page. */}
      <section className="border-b border-rule px-5 py-6">
        <blockquote className="font-quote text-[26px] leading-snug font-semibold text-ink">
          <span className="text-ink-faint">&ldquo;</span>
          {p.rawStatement}
          <span className="text-ink-faint">&rdquo;</span>
        </blockquote>

        <p className="mt-3 text-[13px] text-ink-faint">
          Said {formatDate(p.statementDate)}
          {p.sourceContext ? ` · ${p.sourceContext}` : ''}
        </p>

        {(p.sourceUrl || p.archiveUrl) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {p.sourceUrl && (
              <ExternalLink
                href={p.sourceUrl}
                className="rounded-full border border-rule px-2.5 py-0.5 text-[11px] text-ink-dim underline-offset-2 hover:underline"
              >
                Source
              </ExternalLink>
            )}
            {p.archiveUrl ? (
              <ExternalLink
                href={p.archiveUrl}
                className="rounded-full border border-rule px-2.5 py-0.5 text-[11px] text-ink-dim underline-offset-2 hover:underline"
              >
                Archived copy
              </ExternalLink>
            ) : (
              p.sourceUrl && <Pill tone="muted">Archive {p.archiveStatus}</Pill>
            )}
          </div>
        )}
      </section>

      {p.status === 'draft' && (
        <section className="border-b border-rule px-5 py-4">
          <p className="text-[13px] text-ink-dim">
            This is still a draft. Nothing is tracked and no clock is running.
          </p>
          <Link
            to={`/draft/${p.id}`}
            className="mt-2 inline-block rounded border border-draft px-3 py-1.5 text-[13px] text-draft"
          >
            Finish setting this up
          </Link>
        </section>
      )}

      {/* Where it stands. The single most useful thing on the screen, so it
          gets the size rather than sharing a grey band with everything else. */}
      <section className="border-b border-rule px-5 py-6">
        <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          {isResolved(p.status) ? (
            <>
              {/* The stamp already says the verdict, so saying it again in
                  words beside it is just noise. This carries the when. */}
              <p className="font-display text-[28px] leading-none font-semibold">
                {formatDate(p.resolvedAt)}
              </p>
              <p className="mt-2 text-[13px] text-ink-faint">
                {p.resolvedBy === 'user_override'
                  ? 'Overridden by you'
                  : p.resolvedBy === 'user'
                    ? 'You called it'
                    : p.resolvedBy === 'auto'
                      ? `Settled by the app${settledBy ? ` · ${describeSources(settledBy.evidence)}` : ''}`
                      : 'Settled'}
              </p>
              {/* The app decided this one without asking. The way to disagree
                  is Reopen, which sat at the bottom of the screen among six
                  other buttons, so nothing near the stamp said the verdict
                  could be challenged at all. Reopening puts it back to open,
                  on the record as overridden, and the next check or a manual
                  resolve settles it again. */}
              {p.resolvedBy === 'auto' && (
                <button
                  type="button"
                  onClick={() => update.mutate({ id: p.id, patch: reopen(p) })}
                  className="mt-2 text-[13px] text-ink-dim underline-offset-2 hover:underline"
                >
                  Not right? Reopen it
                </button>
              )}

            </>
          ) : (
            <>
              <p
                className={`flex items-center gap-2 font-display text-[34px] leading-none font-semibold ${countdownTone}`}
              >
                <TrendMark trend={p.trend} />
                {p.status === 'draft' ? 'Unfinished' : formatCountdown(p)}
              </p>
              <p className="mt-2 text-[13px] text-ink-faint">{describeDeadline(p)}</p>
            </>
          )}
          {isUnderLateWatch(p) && (
            <p className="mt-2 text-[12px] text-ink-faint">
              Still watching until {formatDate(p.lateWatchUntil)}
            </p>
          )}
          {/* The feed row carried a stakes pill and this screen dropped it, so
              tapping into the full story lost the one thing riding on it. It
              belongs next to the clock: the bet and the deadline are the two
              halves of the same sentence. */}
          {p.stakes && (
            <p className="mt-2 text-[13px] text-ink-dim">
              Riding on it: <span className="text-ink">{p.stakes}</span>
            </p>
          )}
        </div>
        {isResolved(p.status) && <Stamp status={p.status} size="lg" />}
        </div>

        {/* The reason, at full width under the verdict rather than squeezed
            beside the stamp. It was only ever in the check log, so a settled
            prediction showed a stamp, a date and a score, and nothing at all
            about why. */}
        {settledBy && (
          <div className="mt-4">
            <p className="text-[15px] leading-snug text-ink-dim">{settledBy.check.summary}</p>
            {settledSource && (
              <ExternalLink
                href={settledSource.url}
                className="mt-2 inline-flex items-center gap-1 text-[13px] text-ink-dim underline-offset-2 hover:underline"
              >
                {settledSource.publisher ?? hostOf(settledSource.url) ?? 'Source'}
                <Icon name="chevron" size={14} className="text-ink-faint" />
              </ExternalLink>
            )}
          </div>
        )}
      </section>

      {late && (
        <div className="border-b border-rule px-5 py-4">
          <LateBadge label={late} />
          <p className="mt-2 text-[13px] text-ink-dim">
            The verdict stays a miss. The timeframe was part of the claim.
          </p>
        </div>
      )}

      {awaitingAnswer && (
        <section className="border-b border-rule bg-attention/5 px-5 py-5">
          <h2 className="label text-attention">
            {searchedInVain ? 'Checked, and still open' : 'Only you can settle this'}
          </h2>
          <p className="mt-2 font-display text-[20px] font-semibold tracking-wide">Did it happen?</p>
          {searchedInVain && (
            <p className="mt-1 text-[12px] text-ink-faint">
              The deadline passed and the last check could not stand its own evidence up. What it
              found is in the log below.
            </p>
          )}
          {p.promptSnoozes > 0 && (
            <p className="mt-1 text-[12px] text-ink-faint">
              Put off {p.promptSnoozes} time{p.promptSnoozes === 1 ? '' : 's'} so far.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => resolveManually.mutate({ id: p.id, verdict: 'hit' })}
              className="min-h-11 rounded border border-hit px-5 text-[13px] text-hit"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => resolveManually.mutate({ id: p.id, verdict: 'miss' })}
              className="min-h-11 rounded border border-miss px-5 text-[13px] text-miss"
            >
              No
            </button>
            <button
              type="button"
              onClick={() => snooze.mutate(p.id)}
              className="min-h-11 rounded border border-rule px-5 text-[13px] text-ink-dim"
            >
              Not yet
            </button>
          </div>
        </section>
      )}

      {queuedVerdict && (
        <section className="border-b border-rule bg-attention/5 px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="label text-attention">
              Verdict ready for you
            </h2>
            {/* A seeded verdict is indistinguishable from a real finding on
                this card, and one was believed: the seed used to assert a
                World Series that had not been played, on example.com under
                real wire service names. The sample now carries a verified
                result on real addresses, and the badge stays either way. */}
            {queuedVerdict.provider === 'demo' && <Pill tone="warn">Sample</Pill>}
          </div>
          <p className="mt-2 text-[14px] leading-relaxed text-prose">
            {STATUS_LABEL[queuedVerdict.proposedVerdict as PredictionStatus]}
            {queuedEvidence.length > 0 && (
              <span className="text-ink-faint"> · {describeSources(queuedEvidence)}</span>
            )}
          </p>
          <p className="mt-1 text-[14px] text-ink-dim">{queuedVerdict.summary}</p>
          <p className="mt-2 text-[12px] text-ink-faint">
            The evidence is in the check log below. Nothing changes until you say so.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => approve.mutate({ predictionId: p.id, checkId: queuedVerdict.id })}
              className="min-h-11 rounded border border-hit px-4 text-[13px] text-hit"
            >
              Accept it
            </button>
            <button
              type="button"
              onClick={() => reject.mutate(queuedVerdict.id)}
              className="min-h-11 rounded border border-rule px-4 text-[13px] text-ink-dim"
            >
              Not convinced
            </button>
          </div>
        </section>
      )}

      {/* Criteria. */}
      <section className="border-b border-rule px-5 py-5">
        <div className="flex items-baseline justify-between">
          <h2 className="label">
            Resolution criteria
          </h2>
          {p.criteriaFrozenAt || isResolved(p.status) ? (
            <Pill
              tone="muted"
              title={
                p.criteriaFrozenAt ? `Frozen ${formatDate(p.criteriaFrozenAt)}` : 'Frozen on resolution'
              }
            >
              Frozen
            </Pill>
          ) : (
            <Pill tone="muted">Not yet frozen</Pill>
          )}
        </div>

        <ul className="mt-3 space-y-2">
          {criteria.map((c) => (
            <li key={c.id} className="flex items-start gap-4 py-1.5">
              {/* The mark follows the verdict: a check writes it, and a
                  verdict called by hand writes it. It used to be a button that
                  cycled the mark and stored a flag nothing read, first on every
                  prediction, then only on ones the person settles. Same dead
                  control either way. */}
              <span
                className="shrink-0"
                title={
                  c.satisfied === null
                    ? 'Not settled yet'
                    : `Found ${c.satisfied ? 'met' : 'not met'}`
                }
              >
                <CriterionMark satisfied={c.satisfied} />
              </span>
              {amendingCriterion === c.id ? (
                <AmendForm
                  className="min-w-0 flex-1"
                  initial={c.text}
                  onCancel={() => setAmendingCriterion(null)}
                  onSubmit={(value, reason) => {
                    amendCriterion.mutate({ criterionId: c.id, text: value, reason });
                    setAmendingCriterion(null);
                  }}
                />
              ) : (
                // Frozen is accountable, not absolute. The drafting model gets
                // dates wrong, and a criterion nobody can correct is a
                // prediction that can never be settled. The edit is logged with
                // its reason like every other amendment.
                <button
                  type="button"
                  aria-label={`Amend criterion ${c.position + 1}`}
                  onClick={() => setAmendingCriterion(c.id)}
                  className="-my-1 flex flex-1 items-start gap-2 py-1 text-left text-[15px] leading-snug text-ink-dim active:opacity-60"
                >
                  <span className="min-w-0 flex-1">{c.text}</span>
                  {/* Without this the criterion was just text, and the only
                      thing on screen that looked like a way to fix a wrong one
                      was the "Amend claim" button, which edits a different
                      field entirely. */}
                  <Icon name="edit" size={15} className="mt-0.5 shrink-0 text-ink-faint" />
                </button>
              )}
            </li>
          ))}
          {criteria.length === 0 && (
            <li className="text-[14px] text-ink-faint italic">No criteria recorded.</li>
          )}
        </ul>

        {p.polarity === 'negative' && p.disconfirmingTrigger && (
          <div className="mt-4 rounded border border-rule bg-surface px-3 py-2.5">
            <p className="label">
              Kills this claim
            </p>
            <p className="mt-1 text-[14px] text-ink-dim">{p.disconfirmingTrigger}</p>
          </div>
        )}

        {amendments.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-[13px] text-ink-dim">
              {amendments.length} amendment{amendments.length === 1 ? '' : 's'} on record
            </summary>
            <ul className="mt-2 space-y-3 border-l border-rule pl-3">
              {amendments.map((a) => (
                <li key={a.id} className="text-[13px]">
                  <p className="text-ink-faint">
                    {formatDate(a.amendedAt)} · {a.field}
                  </p>
                  <p className="mt-0.5 text-ink-faint line-through">{a.oldValue}</p>
                  <p className="text-ink-dim">{a.newValue}</p>
                  <p className="mt-0.5 text-ink-faint italic">{a.reason}</p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* Check log. The evidence trail is the record, so it is never collapsed. */}
      <section className="px-5 py-5">
        <h2 className="label">
          Check log
        </h2>
        {p.verificationMode === 'manual' ? (
          p.status === 'open' && !awaitingAnswer ? (
            /* A "you decide" bet has no check log, so this slot used to hold a
               sentence and the way to settle it sat four buttons down in grey.
               The sentence is now the button. Past the deadline the Yes / No
               card above takes over, so this only shows while it is running. */
            <div className="mt-3 rounded border border-rule bg-surface p-3">
              <p className="text-[14px] text-ink-dim">
                Nothing is searched for this one. When you know how it turned out, call it.
              </p>
              <button
                type="button"
                onClick={() => setShowResolve(true)}
                className={`${primaryButton} mt-3 min-h-11 w-full px-4 text-[15px]`}
              >
                Settle it
              </button>
            </div>
          ) : (
            <p className="mt-3 text-[14px] text-ink-faint italic">
              This one was yours to settle. Nothing was searched.
            </p>
          )
        ) : (
          <CheckLog entries={log} summaryShownAbove={queuedVerdict?.id} />
        )}
      </section>

      {/* Actions. */}
      <section className="border-t border-rule px-5 pt-5 pb-8">
        <h2 className="label">
          Actions
        </h2>
        {/* A grid, not a wrap. The buttons have four different label lengths, so
            wrapping them left a ragged two-then-two block that looked like a
            mistake and put Delete next to Amend at a random offset. */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {isResolved(p.status) && (
            <ActionButton
              disabled={receipt.state === 'rendering'}
              onClick={() =>
                receipt.generate(
                  <ReceiptCard
                    prediction={p}
                    author={author}
                    sources={log.flatMap((entry) => entry.evidence).filter((e) => e.fetchStatus === 'ok')}
                    amendmentCount={amendments.length}
                  />,
                  `${author.displayName} ${p.rawStatement}`,
                  'receipt',
                )
              }
            >
              {receipt.state === 'rendering' ? <Busy>Making the card...</Busy> : 'Share the receipt'}
            </ActionButton>
          )}
          {p.verificationMode === 'searchable' &&
            (!isResolved(p.status) || isUnderLateWatch(p)) && (
            <ActionButton
              onClick={() => pull.mutate({ onlyPredictionId: p.id })}
              disabled={pull.isPending}
            >
              {pull.isPending ? <Busy>{describeProgress(pull.progress)}</Busy> : 'Check now'}
            </ActionButton>
          )}
          {!isResolved(p.status) && (
            <ActionButton
              onClick={() => setShowResolve((v) => !v)}
              tone={p.verificationMode === 'manual' ? 'primary' : 'normal'}
            >
              {p.verificationMode === 'manual' ? 'Settle it' : 'Resolve manually'}
            </ActionButton>
          )}
          {isResolved(p.status) && (
            <ActionButton onClick={() => update.mutate({ id: p.id, patch: reopen(p) })}>
              Reopen
            </ActionButton>
          )}
          <ActionButton onClick={() => setAmending((v) => !v)}>Amend claim</ActionButton>
          {/* A record nobody can delete by accident is the whole point, so
              the question is asked in a dialog of our own: the WebView's
              confirm() carries the origin in its title and looks like a scam,
              and the earlier in-place "Delete for good" swap read as a
              glitch. */}
          <ActionButton tone="danger" onClick={() => setConfirmingDelete(true)}>
            Delete
          </ActionButton>
        </div>
        <ConfirmDialog
          open={confirmingDelete}
          title="Delete this prediction?"
          body="It comes off the record, along with its checks and its place in the standings."
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setConfirmingDelete(false);
            remove.mutate(p.id);
            navigate('/', { replace: true });
          }}
        />

        {receipt.error && <p className="mt-2 text-[12px] text-miss">{receipt.error}</p>}
        {receipt.state === 'downloaded' && (
          <p className="mt-2 text-[12px] text-ink-faint">Saved to your downloads.</p>
        )}

        {showResolve && (
          <div ref={revealed} className="mt-4 rounded border border-rule bg-surface p-3">
            <p className="text-[13px] text-ink-dim">What actually happened?</p>
            {/* Each verdict in its own colour, the same one the stamp will use
                once it is chosen. Five identical outlines made picking one a
                reading exercise, and the app already has a palette for exactly
                this. The label carries the meaning, so colour is never alone. */}
            <div className="mt-2 flex flex-wrap gap-2">
              {VERDICTS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onResolve(v)}
                  // The void stamp is struck through, which on a button someone
                  // has not pressed yet reads as disabled.
                  className={`min-h-11 rounded border px-4 text-[13px] active:bg-surface-raised ${STATUS_TONE[v].replace(' line-through', '')}`}
                >
                  {STATUS_LABEL[v]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Only where the claim could still come true. A day's high temperature
            cannot happen later, and offering to log that it did was the app
            asking a question with no possible answer. */}
        {p.status === 'miss' && !p.lateHitAt && p.canHappenLate && (
          <div className="mt-4 rounded border border-late/40 bg-late/5 p-3">
            <p className="text-[13px] text-ink-dim">It happened anyway. When?</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={lateDate}
                onChange={(e) => setLateDate(e.target.value)}
                className="rounded border border-rule bg-ground px-2 py-1.5 text-[13px]"
              />
              <button
                type="button"
                disabled={!lateDate}
                onClick={() =>
                  update.mutate({
                    id: p.id,
                    patch: markLateHit(p, endOfLocalDay(lateDate)),
                  })
                }
                className="min-h-11 rounded border border-late px-4 text-[13px] text-late disabled:opacity-40"
              >
                Log late hit
              </button>
            </div>
          </div>
        )}

        {amending && (
          <AmendForm
            hostRef={revealed}
            initial={p.normalizedClaim}
            onCancel={() => setAmending(false)}
            onSubmit={(value, reason) => {
              amend.mutate({ id: p.id, field: 'normalizedClaim', value, reason });
              setAmending(false);
            }}
          />
        )}
      </section>
    </Screen>
  );
}

/** The padding around this is the tap target; the border is the mark.
 *  Putting both on one element drew a 36px box around a 12px glyph. */
function CriterionMark({ satisfied }: { satisfied: boolean | null }) {
  return (
    <span
      className={`flex h-5 w-5 items-center justify-center rounded border text-[12px] ${
        satisfied === true
          ? 'border-hit text-hit'
          : satisfied === false
            ? 'border-miss text-miss'
            : 'border-rule text-ink-faint'
      }`}
    >
      {satisfied === true ? '✓' : satisfied === false ? '✕' : '?'}
    </span>
  );
}

function ActionButton({
  children,
  onClick,
  tone = 'normal',
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: 'normal' | 'danger' | 'primary';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        tone === 'primary'
          ? `${primaryButton} min-h-11 px-4 text-[13px]`
          : `min-h-11 rounded border px-4 text-[13px] active:bg-surface-raised disabled:opacity-40 ${
              tone === 'danger' ? 'border-miss/40 text-miss/90' : 'border-rule/70 text-ink-faint'
            }`
      }
    >
      {children}
    </button>
  );
}

const TIER_RANK: Record<string, number> = {
  primary: 0,
  major_outlet: 1,
  secondary: 2,
  social: 3,
};

/** The one citation to put a verdict's name on: confirmed first, then tier. */
function bestSource(evidence: Evidence[]): Evidence | null {
  const ranked = [...evidence].sort((a, b) => {
    const opens = (e: Evidence) => e.fetchStatus === 'ok' || e.fetchStatus === 'blocked';
    const confirmed = Number(opens(b)) - Number(opens(a));
    if (confirmed !== 0) return confirmed;
    return (TIER_RANK[a.tier ?? 'social'] ?? 3) - (TIER_RANK[b.tier ?? 'social'] ?? 3);
  });
  return ranked[0] ?? null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function AmendForm({
  initial,
  onSubmit,
  onCancel,
  hostRef,
  className = 'mt-4',
}: {
  initial: string;
  onSubmit: (value: string, reason: string) => void;
  onCancel: () => void;
  hostRef?: React.Ref<HTMLDivElement>;
  /** Inline inside a criterion row it needs no top margin and must not overflow. */
  className?: string;
}) {
  const [value, setValue] = useState(initial);
  const [reason, setReason] = useState('');
  const valid = value.trim().length > 0 && reason.trim().length > 0 && value !== initial;

  return (
    <div
      ref={hostRef}
      className={`rounded-lg border border-rule bg-surface p-3 ${className}`}
    >
      <p className="text-[13px] text-ink-dim">
        Editing is allowed. Hiding the edit is not, so the reason goes on the record.
      </p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        className="mt-2 w-full rounded border border-rule bg-ground px-2.5 py-2 text-[14px]"
      />
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why is this changing?"
        className="mt-2 w-full rounded border border-rule bg-ground px-2.5 py-2 text-[14px]"
      />
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={!valid}
          onClick={() => onSubmit(value.trim(), reason.trim())}
          className="rounded-lg border border-rule px-3 py-1.5 font-display text-[13px] tracking-wide text-ink-dim disabled:opacity-40"
        >
          Record amendment
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded border border-rule px-4 text-[13px] text-ink-dim"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
