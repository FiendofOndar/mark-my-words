import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SendIntent } from 'send-intent';
import { isNative } from '../platform';

export interface SharedCapture {
  text: string;
  url: string | null;
}

/**
 * Receiving a share from another app.
 *
 * This is the capture path that matters: seeing a claim in Instagram or Reddit
 * and getting it into the ledger in one tap, while you still remember who said
 * it. A capture that takes more than one tap does not happen.
 */
export function useShareTarget() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNative()) return;

    const handle = async () => {
      try {
        const result = await SendIntent.checkSendIntentReceived();
        if (!result) return;

        const shared = normalizeIntent(result);
        if (!shared.text && !shared.url) return;

        navigate('/new', { state: shared, replace: false });
        await SendIntent.finish();
      } catch {
        /* nothing was shared into the app */
      }
    };

    void handle();
    window.addEventListener('sendIntentReceived', handle);
    return () => window.removeEventListener('sendIntentReceived', handle);
  }, [navigate]);
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/i;

/**
 * Android hands over the shared text, sometimes the URL separately, sometimes
 * only a blob with the link buried in it.
 */
export function normalizeIntent(result: {
  title?: string;
  url?: string;
  description?: string;
}): SharedCapture {
  const body = decodeSafely(result.description ?? result.title ?? '');
  const explicit = decodeSafely(result.url ?? '');

  const url = explicit || body.match(URL_PATTERN)?.[0] || null;
  // The link on its own is not a statement, so it is not worth carrying into
  // the statement field where it would have to be deleted.
  const text = body === url ? '' : body.replace(URL_PATTERN, '').trim();

  return { text, url };
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}
