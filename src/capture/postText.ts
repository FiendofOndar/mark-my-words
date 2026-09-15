import type { ArchiveHttp } from './archive';

/**
 * The words of a post, from its link, for the platforms that hand them over
 * without a login.
 *
 * X publishes a post through its embed endpoint as a blockquote of HTML, and
 * Reddit serves any post as JSON when ".json" is appended to its path. Both
 * shapes are written from memory (the build container cannot reach either
 * host), so the parsers are defensive and a miss returns null, which the
 * capture screen turns into "screenshot it instead". Instagram, TikTok,
 * Threads and YouTube give a link nothing usable, so they are not here.
 */
export interface PostText {
  text: string;
  author: string | null;
  /** YYYY-MM-DD when the response carried a date. */
  postedOn: string | null;
}

export type PostHost = 'x' | 'reddit';

export function postTextSupported(url: string): PostHost | null {
  let host: string;
  let path: string;
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\.|^mobile\.|^old\./, '').toLowerCase();
    path = u.pathname;
  } catch {
    return null;
  }
  if ((host === 'x.com' || host === 'twitter.com') && /\/status\/\d+/.test(path)) return 'x';
  if (host === 'reddit.com' && /\/comments\/[a-z0-9]+/i.test(path)) return 'reddit';
  return null;
}

export async function fetchPostText(
  url: string,
  http: ArchiveHttp,
  timeoutMs = 10_000,
): Promise<PostText | null> {
  const host = postTextSupported(url);
  if (!host) return null;
  try {
    if (host === 'x') {
      const endpoint = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=1&dnt=1`;
      const response = await http.get(endpoint, timeoutMs);
      if (response.status !== 200) return null;
      return parseXEmbed(JSON.parse(response.text));
    }
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    u.hostname = 'www.reddit.com';
    const endpoint = `${u.toString().replace(/\/$/, '')}.json?limit=1&raw_json=1`;
    const response = await http.get(endpoint, timeoutMs);
    if (response.status !== 200) return null;
    return parseRedditListing(JSON.parse(response.text));
  } catch {
    return null;
  }
}

/** `{ html: "<blockquote><p>words</p>&mdash; Name (@handle) <a>June 1, 2025</a></blockquote>", author_name }` */
export function parseXEmbed(raw: unknown): PostText | null {
  const r = (raw ?? {}) as { html?: unknown; author_name?: unknown };
  if (typeof r.html !== 'string') return null;
  const html = r.html;

  const paragraph = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1];
  if (!paragraph) return null;
  const text = decodeEntities(
    paragraph.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''),
  ).trim();
  if (!text) return null;

  const tail = html.slice(html.indexOf('</p>') + 4);
  const handle = tail.match(/\(@([A-Za-z0-9_]+)\)/)?.[1];
  const author = handle ? `@${handle}` : typeof r.author_name === 'string' ? r.author_name : null;
  const dateText = decodeEntities(tail.replace(/<[^>]+>/g, '')).match(
    /([A-Z][a-z]+ \d{1,2}, \d{4})/,
  )?.[1];

  return { text, author, postedOn: dateText ? toIsoDate(dateText) : null };
}

/** The listing Reddit returns for `<post-url>.json`: `[{ data: { children: [{ data: post }] } }, comments]` */
export function parseRedditListing(raw: unknown): PostText | null {
  const listing = Array.isArray(raw) ? raw[0] : raw;
  const post = (listing as { data?: { children?: { data?: Record<string, unknown> }[] } })?.data
    ?.children?.[0]?.data;
  if (!post || typeof post.title !== 'string') return null;

  const body = typeof post.selftext === 'string' ? post.selftext.trim() : '';
  const usable = body && !/^\[(removed|deleted)\]$/i.test(body) ? body : '';
  const text = usable ? `${post.title.trim()}\n\n${usable}` : post.title.trim();
  const author = typeof post.author === 'string' && post.author ? `u/${post.author}` : null;
  const created = typeof post.created_utc === 'number' ? post.created_utc : null;
  const postedOn = created ? new Date(created * 1000).toISOString().slice(0, 10) : null;

  return { text, author, postedOn };
}

function toIsoDate(text: string): string | null {
  const ms = Date.parse(`${text} 12:00:00 UTC`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
