import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Screen } from '../components/Screen';
import {
  PredictionForm,
  emptyFormValues,
  toFormValues,
  toNewPrediction,
  type PredictionFormValues,
} from '../components/PredictionForm';
import {
  useAuthors,
  useConfirmDraft,
  useDeletePrediction,
  useFindOrCreateAuthor,
  usePrediction,
  useUpdateDraft,
} from '../queries';
import { formatDate } from '../../domain/format';
import type { IntakeNotes } from '../../domain/types';

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
        initial={initial}
        authors={authors}
        submitLabel="Put it on the record"
        busy={busy}
        onSubmit={submit}
        ambiguities={notes?.ambiguities ?? []}
        deadlineNote={notes?.deadlineReasoning}
        verifiabilityNote={notes?.verifiabilityReasoning}
        banner={notes ? <IntakeBanner notes={notes} /> : <ManualBanner />}
      />
    </Screen>
  );
}

function IntakeBanner({ notes }: { notes: IntakeNotes }) {
  const offline = notes.provider === 'mock';

  return (
    <section
      className={`rounded border px-3 py-2.5 ${
        offline ? 'border-partial/40 bg-partial/5' : 'border-rule bg-surface'
      }`}
    >
      <p className={`text-[13px] ${offline ? 'text-partial' : 'text-ink-dim'}`}>
        {offline
          ? 'Drafted offline by pattern matching, not by a model. Treat every field below as a guess.'
          : `Drafted by ${notes.model}. Nothing is tracked until you confirm it.`}
      </p>
      {notes.warnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {notes.warnings.map((warning) => (
            <li key={warning} className="text-[12px] text-ink-faint">
              · {warning}
            </li>
          ))}
        </ul>
      )}
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
