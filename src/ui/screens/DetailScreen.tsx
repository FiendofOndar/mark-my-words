import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { Stamp, LateBadge, Pill } from '../components/Stamp';
import { TrendMark } from '../components/TrendMark';
import {
  useAmendPrediction,
  useApproveVerdict,
  useCheckLog,
  useDeletePrediction,
  usePrediction,
  usePull,
  useQueuedVerdicts,
  useRejectVerdict,
  useResolveManually,
  useSetCriterionSatisfied,
  useSnoozePrompt,
  useUpdatePrediction,
} from '../queries';
import { CheckLog } from '../components/CheckLog';
import { ReceiptCard } from '../../receipts/ReceiptCard';
import { useReceipt } from '../../receipts/useReceipt';
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
  isPastDeadline,
  isUnderLateWatch,
  markLateHit,
  reopen,
} from '../../domain/prediction';
import type { PredictionStatus } from '../../domain/types';

const VERDICTS: PredictionStatus[] = ['hit', 'miss', 'partial', 'ambiguous', 'void'];

export function DetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
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
  const remove = useDeletePrediction();
  const setSatisfied = useSetCriterionSatisfied();

  const [showResolve, setShowResolve] = useState(false);
  const [amending, setAmending] = useState(false);
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
          ? 'text-partial'
          : 'text-ink';

  const awaitingAnswer =
    p.status === 'open' && p.verificationMode === 'manual' && isPastDeadline(p);

  const onResolve = (verdict: PredictionStatus) => {
    resolveManually.mutate({ id: p.id, verdict });
    setShowResolve(false);
  };

  return (
    <Screen
      title={
        <Link to={`/author/${author.id}`} className="underline-offset-4 hover:underline">
          {author.displayName}
        </Link>
      }
      subtitle={author.handle ?? undefined}
      back
    >
      {/* The quote carries the page. */}
      <section className="paper border-b border-rule bg-surface px-5 py-6">
        <blockquote className="font-display text-[22px] leading-snug text-ink">
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
              <a
                href={p.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-full border border-rule px-2.5 py-0.5 text-[11px] text-ink-dim underline-offset-2 hover:underline"
              >
                Source
              </a>
            )}
            {p.archiveUrl ? (
              <a
                href={p.archiveUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-full border border-rule px-2.5 py-0.5 text-[11px] text-ink-dim underline-offset-2 hover:underline"
              >
                Archived copy
              </a>
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
      <section className="flex items-center justify-between gap-4 border-b border-rule px-5 py-6">
        <div className="min-w-0">
          {isResolved(p.status) ? (
            <>
              {/* The stamp already says the verdict, so saying it again in
                  words beside it is just noise. This carries the when. */}
              <p className="font-display text-[26px] leading-none">
                {formatDate(p.resolvedAt)}
              </p>
              <p className="mt-2 text-[13px] text-ink-faint">
                {p.resolvedBy === 'user_override'
                  ? 'Overridden by you'
                  : p.resolvedBy === 'user'
                    ? 'You called it'
                    : p.resolvedBy === 'auto'
                      ? `Settled automatically, scored ${p.confidenceScore ?? '--'}/100`
                      : 'Settled'}
              </p>
            </>
          ) : (
            <>
              <p
                className={`flex items-center gap-2 font-display text-[32px] leading-none ${countdownTone}`}
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
        </div>
        {isResolved(p.status) && <Stamp status={p.status} size="lg" />}
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
        <section className="border-b border-rule bg-partial/5 px-5 py-5">
          <h2 className="text-[11px] font-semibold tracking-wide text-partial uppercase">
            Only you can settle this
          </h2>
          <p className="mt-2 font-display text-[19px]">Did it happen?</p>
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
        <section className="border-b border-rule bg-partial/5 px-5 py-5">
          <h2 className="text-[11px] font-semibold tracking-wide text-partial uppercase">
            Verdict ready for you
          </h2>
          <p className="mt-2 font-display text-[17px] leading-snug text-ink">
            {STATUS_LABEL[queuedVerdict.proposedVerdict as PredictionStatus]}
            {queuedVerdict.rubricScore !== null && (
              <span className="text-ink-faint"> · scored {queuedVerdict.rubricScore}/100</span>
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
          <h2 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
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
            <Pill tone="muted">Editable until first check</Pill>
          )}
        </div>

        <ul className="mt-3 space-y-2">
          {criteria.map((c) => (
            <li key={c.id} className="flex items-start gap-4 py-1.5">
              {/* The padding is the tap target; the border is the mark. Putting
                  both on one element drew a 36px box around a 12px glyph. */}
              <button
                type="button"
                aria-label={`Mark element ${c.position + 1} as ${c.satisfied ? 'unknown' : 'satisfied'}`}
                onClick={() =>
                  setSatisfied.mutate({
                    id: c.id,
                    satisfied: c.satisfied === true ? false : c.satisfied === false ? null : true,
                  })
                }
                className="-m-2 shrink-0 p-2"
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded border text-[12px] ${
                    c.satisfied === true
                      ? 'border-hit text-hit'
                      : c.satisfied === false
                        ? 'border-miss text-miss'
                        : 'border-rule text-ink-faint'
                  }`}
                >
                  {c.satisfied === true ? '✓' : c.satisfied === false ? '✕' : '?'}
                </span>
              </button>
              <span className="text-[15px] leading-snug text-ink-dim">{c.text}</span>
            </li>
          ))}
          {criteria.length === 0 && (
            <li className="text-[14px] text-ink-faint italic">No criteria recorded.</li>
          )}
        </ul>

        {p.polarity === 'negative' && p.disconfirmingTrigger && (
          <div className="mt-4 rounded border border-rule bg-surface px-3 py-2.5">
            <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
              Kills this claim
            </p>
            <p className="mt-1 text-[14px] text-ink-dim">{p.disconfirmingTrigger}</p>
          </div>
        )}

        {amendments.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-[13px] text-partial">
              {amendments.length} amendment{amendments.length === 1 ? '' : 's'} on record
            </summary>
            <ul className="mt-2 space-y-3 border-l border-partial/40 pl-3">
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
        <h2 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
          Check log
        </h2>
        {p.verificationMode === 'manual' ? (
          <p className="mt-3 text-[14px] text-ink-faint italic">
            This one is yours to settle. Nothing is searched.
          </p>
        ) : (
          <CheckLog entries={log} />
        )}
      </section>

      {/* Actions. */}
      <section className="border-t border-rule px-5 pt-5 pb-8">
        <h2 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
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
              {receipt.state === 'rendering' ? 'Making the card...' : 'Share the receipt'}
            </ActionButton>
          )}
          {p.verificationMode === 'searchable' &&
            (!isResolved(p.status) || isUnderLateWatch(p)) && (
            <ActionButton
              onClick={() => pull.mutate({ onlyPredictionId: p.id })}
              disabled={pull.isPending}
            >
              {pull.isPending ? 'Checking...' : 'Check now'}
            </ActionButton>
          )}
          {!isResolved(p.status) && (
            <ActionButton onClick={() => setShowResolve((v) => !v)}>Resolve manually</ActionButton>
          )}
          {isResolved(p.status) && (
            <ActionButton onClick={() => update.mutate({ id: p.id, patch: reopen(p) })}>
              Reopen
            </ActionButton>
          )}
          <ActionButton onClick={() => setAmending((v) => !v)}>Amend claim</ActionButton>
          {/* Two taps, in place. A record nobody can delete by accident is the
              whole point, and a WebView confirm() dialog looks like a scam. */}
          {confirmingDelete ? (
            <>
              <ActionButton
                tone="danger"
                onClick={() => {
                  remove.mutate(p.id);
                  navigate('/', { replace: true });
                }}
              >
                Delete for good
              </ActionButton>
              <ActionButton onClick={() => setConfirmingDelete(false)}>Keep it</ActionButton>
            </>
          ) : (
            <ActionButton tone="danger" onClick={() => setConfirmingDelete(true)}>
              Delete
            </ActionButton>
          )}
        </div>

        {receipt.error && <p className="mt-2 text-[12px] text-miss">{receipt.error}</p>}
        {receipt.state === 'downloaded' && (
          <p className="mt-2 text-[12px] text-ink-faint">Saved to your downloads.</p>
        )}

        {showResolve && (
          <div className="mt-4 rounded border border-rule bg-surface p-3">
            <p className="text-[13px] text-ink-dim">What actually happened?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {VERDICTS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onResolve(v)}
                  className="min-h-11 rounded border border-rule px-4 text-[13px] active:bg-surface-raised"
                >
                  {STATUS_LABEL[v]}
                </button>
              ))}
            </div>
          </div>
        )}

        {p.status === 'miss' && !p.lateHitAt && (
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

function ActionButton({
  children,
  onClick,
  tone = 'normal',
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: 'normal' | 'danger';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-11 rounded border px-4 text-[13px] active:bg-surface-raised disabled:opacity-40 ${
        tone === 'danger' ? 'border-miss/40 text-miss/90' : 'border-rule/70 text-ink-faint'
      }`}
    >
      {children}
    </button>
  );
}

function AmendForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (value: string, reason: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [reason, setReason] = useState('');
  const valid = value.trim().length > 0 && reason.trim().length > 0 && value !== initial;

  return (
    <div className="mt-4 rounded border border-partial/40 bg-surface p-3">
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
          className="rounded border border-partial px-3 py-1.5 text-[13px] text-partial disabled:opacity-40"
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
