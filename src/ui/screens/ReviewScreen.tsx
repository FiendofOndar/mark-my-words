import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Screen } from '../components/Screen';
import {
  PredictionForm,
  emptyFormValues,
  toFormValues,
  toNewPrediction,
  type PredictionFormValues,
} from '../components/PredictionForm';
import { useState } from 'react';
import {
  useAuthors,
  useConfirmDraft,
  useDeletePrediction,
  useFindOrCreateAuthor,
  usePrediction,
  useStructureStatement,
  useUpdateDraft,
} from '../queries';
import { formatDate } from '../../domain/format';
import { toLocalDateInput } from '../../domain/prediction';
import type { IntakeNotes } from '../../domain/types';
import { structuredToDraft } from '../../verification/toPrediction';
import { VerifierError } from '../../verification/types';
import { Bullets } from '../components/Bullets';

/**
 * The review card. A draft is a real row already, so this survives a reload and
 * nothing captured is ever lost waiting for the user to finish thinking.
 */
export function ReviewScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data, isLoading } = usePrediction(id);
  const { data: authors = [] } = useAuthors();

  const findOrCreateAuthor = useFindOrCreateAuthor();
  const updateDraft = useUpdateDraft();
  const confirmDraft = useConfirmDraft();
  const remove = useDeletePrediction();
  const structure = useStructureStatement();
  const [redraftError, setRedraftError] = useState<string | null>(null);

  if (isLoading) return <Screen title="..." back><div /></Screen>;

  if (!data) {
    return (
      <Screen title="Not found" back>
        <p className="px-5 py-10 text-center text-ink-dim">That draft is gone.</p>
      </Screen>
    );
  }

  const { prediction: p, author, criteria } = data;

  // Redeclaring the route rather than calling navigate() during render, which
  // updates the router while this component is still rendering.
  if (p.status !== 'draft') return <Navigate to={`/p/${p.id}`} replace />;

  const notes = p.intakeNotes;
  const initial: PredictionFormValues = {
    ...emptyFormValues(),
    ...toFormValues(p, criteria, author.displayName),
  };

  const submit = async (values: PredictionFormValues, isRetroactive: boolean) => {
    const nextAuthor = await findOrCreateAuthor.mutateAsync({
      displayName: values.authorName.trim(),
    });
    await updateDraft.mutateAsync({
      id: p.id,
      input: { ...toNewPrediction(values, nextAuthor.id), isRetroactive },
    });
    await confirmDraft.mutateAsync(p.id);
    navigate(`/p/${p.id}`, { replace: true });
  };

  /*
   * Draft the testable version, questions and criteria again from the
   * statement as it now reads. The row keeps its id, author and provenance;
   * everything the model wrote is replaced, and the form remounts on the new
   * draft time so it shows the new values rather than its own stale state.
   */
  const redraft = async (rawStatement: string) => {
    setRedraftError(null);
    try {
      const result = await structure.mutateAsync({
        rawStatement: rawStatement.trim(),
        sourceUrl: p.sourceUrl,
        sourceContext: p.sourceContext,
        today: toLocalDateInput(p.statementDate),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      await updateDraft.mutateAsync({
        id: p.id,
        input: structuredToDraft(result, {
          authorId: p.authorId,
          rawStatement: rawStatement.trim(),
          statementDate: p.statementDate,
          sourceUrl: p.sourceUrl,
          sourceContext: p.sourceContext,
        }),
      });
    } catch (err) {
      const detail = err instanceof VerifierError ? err.detail : undefined;
      setRedraftError(`${(err as Error).message}${detail ? ` (${detail})` : ''}`);
    }
  };

  const busy = updateDraft.isPending || confirmDraft.isPending || findOrCreateAuthor.isPending;

  return (
    <Screen
      title="Before the clock starts"
      subtitle={notes ? `Drafted ${formatDate(notes.draftedAt)}` : 'Draft'}
      back
      actions={
        <button
          type="button"
          onClick={() => {
            if (!confirm('Throw this draft away?')) return;
            remove.mutate(p.id);
            navigate('/', { replace: true });
          }}
          className="shrink-0 rounded-full px-2 py-1 text-[13px] text-miss active:bg-surface-raised"
        >
          Discard
        </button>
      }
    >
      <PredictionForm
        key={notes?.draftedAt ?? 'manual'}
        initial={initial}
        authors={authors}
        submitLabel="Put it on the record"
        busy={busy}
        onSubmit={submit}
        ambiguities={notes?.ambiguities ?? []}
        deadlineNote={notes?.deadlineReasoning}
        verifiabilityNote={notes?.verifiabilityReasoning}
        onRedraft={notes && notes.provider !== 'mock' ? redraft : undefined}
        redrafting={structure.isPending || updateDraft.isPending}
        banner={
          notes ? (
            <IntakeBanner notes={notes} error={redraftError} />
          ) : (
            <ManualBanner />
          )
        }
      />
    </Screen>
  );
}

function IntakeBanner({ notes, error }: { notes: IntakeNotes; error?: string | null }) {
  const offline = notes.provider === 'mock';

  return (
    <section
      className={`rounded border px-3 py-2.5 ${
        offline ? 'border-attention/40 bg-attention/5' : 'border-glass-edge bg-glass-fill'
      }`}
    >
      <p className={`text-[13px] leading-relaxed ${offline ? 'text-attention' : 'text-prose-dim'}`}>
        {offline
          ? 'Drafted offline by pattern matching, not by a model. Treat every field below as a guess.'
          : `Drafted by ${notes.model}. Nothing is tracked until you confirm it.`}
      </p>
      {notes.warnings.length > 0 && (
        <Bullets items={notes.warnings} className="mt-2 text-[12px] text-ink-faint" />
      )}
      {error && <p className="mt-2 text-[12px] text-miss">Redraft failed: {error}</p>}
    </section>
  );
}

function ManualBanner() {
  return (
    <section className="rounded border border-rule bg-surface px-3 py-2.5">
      <p className="text-[13px] text-ink-dim">
        Filling this in yourself. The clock starts when you put it on the record.
      </p>
    </section>
  );
}
