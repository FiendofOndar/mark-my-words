import type { Author, Evidence, Prediction } from '../domain/types';
import { describeDeadline, formatDate, formatLateBadge, STATUS_LABEL } from '../domain/format';
import {
  MIN_SCORED_TO_RANK,
  formatHeadline,
  formatRecord,
  type AuthorRecord,
} from '../domain/scoring';

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

const TONE: Record<string, string> = {
  hit: '#5aa87a',
  miss: '#cf6049',
  partial: '#d29a43',
  ambiguous: '#8a8078',
  void: '#5d5650',
};

/**
 * Rendered offscreen at full size and rasterized. Every value is inline rather
 * than themed, because the card leaves the app and has to look the same
 * wherever it lands.
 */
export function ReceiptCard({
  prediction,
  author,
  sources,
  amendmentCount,
}: {
  prediction: Prediction;
  author: Author;
  sources: Evidence[];
  amendmentCount: number;
}) {
  const tone = TONE[prediction.status] ?? '#a49c8f';
  const late = formatLateBadge(prediction);

  return (
    <div style={shell}>
      <div style={{ ...rule, marginBottom: 56 }} />

      <p style={meta}>
        {author.displayName}
        {author.handle ? ` · ${author.handle}` : ''} · {formatDate(prediction.statementDate)}
      </p>

      <blockquote style={{ ...quote, ...quoteSizeFor(prediction.rawStatement) }}>
        <span style={{ color: '#6f675c' }}>&ldquo;</span>
        {prediction.rawStatement}
        <span style={{ color: '#6f675c' }}>&rdquo;</span>
      </blockquote>

      {/* Labelled, because "By Jul 15" sitting under a name reads as a byline. */}
      <p style={{ ...label, marginTop: 48 }}>Called for</p>
      <p style={{ ...meta, marginTop: 8 }}>{describeDeadline(prediction)}</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 28, marginTop: 44 }}>
        <span style={{ ...stamp, color: tone, borderColor: tone }}>
          {STATUS_LABEL[prediction.status]}
        </span>
        {prediction.resolvedAt && (
          <span style={{ ...meta, marginTop: 0, whiteSpace: 'nowrap' }}>
            Settled {formatDate(prediction.resolvedAt)}
          </span>
        )}
      </div>

      {late && (
        <p style={{ ...meta, color: '#c9a227', marginTop: 28, fontSize: 30 }}>★ {late}</p>
      )}

      <div style={{ flex: 1 }} />

      {sources.length > 0 && (
        <div style={{ marginBottom: 36 }}>
          <p style={label}>Evidence</p>
          {sources.slice(0, 3).map((source) => (
            <p key={source.id} style={citation}>
              {source.publisher ?? hostOf(source.url)}
              {source.publishedAt ? ` · ${source.publishedAt}` : ''}
            </p>
          ))}
        </div>
      )}

      <div style={footer}>
        <span>Mark My Words</span>
        <span style={{ color: '#6f675c' }}>
          {prediction.stakes ? `Stakes: ${prediction.stakes}` : ''}
          {prediction.isRetroactive ? '  ·  entered after the fact' : ''}
          {amendmentCount > 0 ? `  ·  amended ${amendmentCount}×` : ''}
        </span>
      </div>
    </div>
  );
}

export function ScorecardCard({
  author,
  record,
  since,
}: {
  author: Author;
  record: AuthorRecord;
  since: string | null;
}) {
  return (
    <div style={shell}>
      <div style={{ ...rule, marginBottom: 56 }} />
      <p style={label}>The record</p>

      <p
        style={{
          ...quote,
          fontSize: author.displayName.length > 22 ? 64 : 96,
          WebkitLineClamp: 3,
          marginTop: 24,
        }}
      >
        {author.displayName}
      </p>
      {author.handle && <p style={meta}>{author.handle}</p>}

      {/*
        An unranked author leads with the record, not the rate.
        "100%" off one settled call is the cherry-picked number the five-call
        threshold exists to refuse, and this is the card that leaves the app and
        gets shown to the person it is about. The rate arrives when it means
        something.
      */}
      <p style={{ fontSize: 220, lineHeight: 1, marginTop: 64, fontFamily: SERIF }}>
        {formatHeadline(record)}
      </p>
      <p style={{ ...meta, fontSize: 40, marginTop: 16 }}>
        {record.ranked
          ? `${formatRecord(record)} on ${record.scored} settled calls`
          : record.scored === 0
            ? 'Nothing settled yet'
            : `${record.scored} settled call${record.scored === 1 ? '' : 's'}. A rate needs ${MIN_SCORED_TO_RANK}.`}
      </p>

      <div style={{ flex: 1 }} />

      <div style={{ marginBottom: 36 }}>
        {record.open > 0 && <p style={citation}>{record.open} still running</p>}
        {record.lateHits > 0 && (
          <p style={{ ...citation, color: '#c9a227' }}>
            {record.lateHits} came true late
          </p>
        )}
        {record.ambiguous + record.voided > 0 && (
          <p style={citation}>{record.ambiguous + record.voided} never settled cleanly</p>
        )}
      </div>

      <div style={footer}>
        <span>Mark My Words</span>
        <span style={{ color: '#6f675c' }}>{since ? `Since ${formatDate(since)}` : ''}</span>
      </div>
    </div>
  );
}

/**
 * The card is a fixed 1080x1350, so a long statement has to be made to fit
 * rather than allowed to run off the bottom. Roughly twenty characters per line
 * at the largest size, with about eight lines of room.
 */
export function quoteSizeFor(statement: string): { fontSize: number; WebkitLineClamp: number } {
  const length = statement.trim().length;
  if (length <= 120) return { fontSize: 72, WebkitLineClamp: 8 };
  if (length <= 220) return { fontSize: 56, WebkitLineClamp: 9 };
  if (length <= 360) return { fontSize: 44, WebkitLineClamp: 11 };
  return { fontSize: 36, WebkitLineClamp: 13 };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const SERIF = "'Newsreader', Georgia, 'Times New Roman', serif";
const SANS = "'Inter', system-ui, sans-serif";

const shell: React.CSSProperties = {
  width: CARD_WIDTH,
  height: CARD_HEIGHT,
  padding: 80,
  boxSizing: 'border-box',
  background: '#111014',
  color: '#ede7dc',
  fontFamily: SANS,
  display: 'flex',
  flexDirection: 'column',
};

const rule: React.CSSProperties = { height: 3, background: '#2e2a35' };

const meta: React.CSSProperties = {
  margin: 0,
  marginTop: 12,
  fontSize: 30,
  color: '#a49c8f',
};

const label: React.CSSProperties = {
  margin: 0,
  fontSize: 24,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: '#6f675c',
};

const quote: React.CSSProperties = {
  margin: 0,
  marginTop: 28,
  fontFamily: SERIF,
  fontSize: 72,
  lineHeight: 1.18,
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const stamp: React.CSSProperties = {
  display: 'inline-block',
  padding: '14px 36px',
  border: '6px solid',
  borderRadius: 8,
  fontSize: 52,
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  transform: 'rotate(-5deg)',
};

const citation: React.CSSProperties = {
  margin: 0,
  marginTop: 10,
  fontSize: 28,
  color: '#a49c8f',
};

const footer: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  borderTop: '3px solid #2e2a35',
  paddingTop: 28,
  fontSize: 28,
  fontFamily: SERIF,
};
