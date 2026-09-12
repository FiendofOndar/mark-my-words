/**
 * Keeping a copy of the source before it disappears.
 *
 * An Instagram story that proves who said what is gone in 24 hours, and a
 * deleted Reddit post takes the receipt with it. Archiving is attempted on
 * capture and retried on later app opens, because it fails often enough that
 * one attempt is not a strategy.
 */
import type { ArchiveStatus } from '../domain/types';

export interface ArchiveOutcome {
  status: ArchiveStatus;
  archiveUrl: string | null;
  /** Shown to the user when the only way to keep the source is a screenshot. */
  note: string | null;
}

export interface ArchiveHttp {
  get(url: string, timeoutMs: number): Promise<{ status: number; text: string; finalUrl: string }>;
}

/**
 * Hosts that reliably defeat both archive services. Going straight to a
 * screenshot prompt is more honest than three failed attempts followed by one.
 */
const HOSTILE = [
  'instagram.com',
  'tiktok.com',
  'facebook.com',
  'threads.net',
  'x.com',
  'twitter.com',
];

export const MAX_ARCHIVE_ATTEMPTS = 3;

export function isHostileHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return HOSTILE.some((bad) => host === bad || host.endsWith(`.${bad}`));
  } catch {
    return false;
  }
}

export async function archiveSource(
  url: string,
  http: ArchiveHttp,
  timeoutMs = 30_000,
): Promise<ArchiveOutcome> {
  if (!url.trim()) {
    return { status: 'not_applicable', archiveUrl: null, note: null };
  }

  if (isHostileHost(url)) {
    return {
      status: 'failed',
      archiveUrl: null,
      note: 'This platform blocks archiving. Attach a screenshot so the source survives deletion.',
    };
  }

  const wayback = await tryWayback(url, http, timeoutMs);
  if (wayback) return { status: 'ok', archiveUrl: wayback, note: null };

  const archiveToday = await tryArchiveToday(url, http, timeoutMs);
  if (archiveToday) return { status: 'ok', archiveUrl: archiveToday, note: null };

  return {
    status: 'pending',
    archiveUrl: null,
    note: 'Could not archive it this time. The app will try again when you next open it.',
  };
}

/** Ask the Wayback Machine to save it, then ask what it has. */
async function tryWayback(url: string, http: ArchiveHttp, timeoutMs: number): Promise<string | null> {
  try {
    const save = await http.get(`https://web.archive.org/save/${url}`, timeoutMs);
    if (save.status >= 200 && save.status < 400 && /web\.archive\.org\/web\//.test(save.finalUrl)) {
      return save.finalUrl;
    }
  } catch {
    /* fall through to the availability check, which sometimes has it anyway */
  }

  try {
    const check = await http.get(
      `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
      timeoutMs,
    );
    if (check.status !== 200) return null;
    const parsed = JSON.parse(check.text) as {
      archived_snapshots?: { closest?: { available?: boolean; url?: string } };
    };
    const closest = parsed.archived_snapshots?.closest;
    return closest?.available && closest.url ? closest.url : null;
  } catch {
    return null;
  }
}

/**
 * archive.today has no API and actively blocks automation, so this is a best
 * effort that is expected to fail more often than it succeeds.
 */
async function tryArchiveToday(
  url: string,
  http: ArchiveHttp,
  timeoutMs: number,
): Promise<string | null> {
  try {
    const response = await http.get(`https://archive.ph/newest/${url}`, timeoutMs);
    if (response.status !== 200) return null;
    return /archive\.(ph|today|is)\/\w+/.test(response.finalUrl) ? response.finalUrl : null;
  } catch {
    return null;
  }
}
