import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isNative } from '../platform';
import { SHARE_RECEIVED_EVENT, ShareIntent, type ShareIntentResult } from '../platform/shareIntent';
import { holdSharedImage, type SharedImage } from '../platform/sharedImage';
import { recordShare } from '../lib/shareLog';

/** What the capture screen receives in router state. */
export interface SharedCapture {
  text: string;
  url: string | null;
  /** A token for holdSharedImage's picture, when a picture was shared. */
  imageToken: string | null;
  /** Something to tell the person about the share, when it could not be filled in. */
  note: string | null;
}

/** The pure shape of a share, before the picture is put anywhere. */
export interface NormalizedShare {
  text: string;
  url: string | null;
  image: SharedImage | null;
  note: string | null;
}

/**
 * Receiving a share from another app.
 *
 * This is the capture path that matters: seeing a claim in Instagram or Reddit
 * and getting it into the ledger in one tap, while you still remember who said
 * it. A capture that takes more than one tap does not happen.
 *
 * Two arrivals. A cold start: the activity was created by the share, and the
 * read on mount finds it. A warm one: the app was already open, Android
 * delivered the share to the running activity, and MainActivity fires the
 * window event so this reads again. The second case used to do nothing at
 * all, which is what "sharing does not work" looked like on the phone.
 */
export function useShareTarget() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNative()) return;

    const handle = async () => {
      let result: ShareIntentResult;
      try {
        result = await ShareIntent.read();
      } catch (err) {
        recordShare(`The share could not be read: ${(err as Error).message}`);
        return;
      }
      if (!result.received) return;
      // Taken; a reload must not deliver it twice. Nothing below depends on it.
      void ShareIntent.consume().catch(() => {});

      const shared = normalizeShare(result);
      recordShare(describeShare(result, shared));
      if (!shared.text && !shared.url && !shared.image && !shared.note) return;

      const state: SharedCapture = {
        text: shared.text,
        url: shared.url,
        imageToken: shared.image ? holdSharedImage(shared.image) : null,
        note: shared.note,
      };
      navigate('/new', { state, replace: false });
    };

    void handle();
    window.addEventListener(SHARE_RECEIVED_EVENT, handle);
    return () => window.removeEventListener(SHARE_RECEIVED_EVENT, handle);
  }, [navigate]);
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/i;

/**
 * Android hands over the text and, sometimes, the link buried inside it. A
 * picture comes as bytes with its own type. A picture the native side could
 * not read arrives as an error, which becomes a note rather than an empty
 * form.
 */
export function normalizeShare(result: ShareIntentResult): NormalizedShare {
  const body = (result.text ?? result.title ?? '').trim();
  const isImage = result.type?.startsWith('image/') ?? false;

  if (isImage && result.imageData) {
    const mimeType =
      result.imageType && result.imageType.startsWith('image/') && !result.imageType.endsWith('*')
        ? result.imageType
        : 'image/jpeg';
    return {
      text: body.replace(URL_PATTERN, '').trim(),
      url: null,
      image: { data: result.imageData, mimeType },
      note: null,
    };
  }
  if (isImage) {
    return {
      text: body.replace(URL_PATTERN, '').trim(),
      url: null,
      image: null,
      note: result.error ?? 'The share named a picture but carried no file.',
    };
  }

  const url = body.match(URL_PATTERN)?.[0] ?? null;
  // The link on its own is not a statement, so it is not worth carrying into
  // the statement field where it would have to be deleted.
  const text = body === url ? '' : body.replace(URL_PATTERN, '').trim();

  return { text, url, image: null, note: null };
}

/** One line for the Settings diagnostic. */
export function describeShare(result: ShareIntentResult, shared: NormalizedShare): string {
  const parts: string[] = [`type ${result.type ?? 'unknown'}`];
  if (shared.image) {
    parts.push(`picture ${shared.image.mimeType}, ${Math.round((shared.image.data.length * 3) / 4 / 1024)} KB`);
  }
  if (shared.text) parts.push(`${shared.text.length} characters of text`);
  if (shared.url) parts.push(`link to ${hostOf(shared.url)}`);
  if (shared.note) parts.push(`note: ${shared.note}`);
  const opened = shared.text || shared.url || shared.image || shared.note;
  return `${parts.join(', ')}. ${opened ? 'Opened the capture screen.' : 'Nothing usable, so nothing opened.'}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
