/**
 * What the app knows about a source on its own, rather than what the model
 * said about it.
 *
 * Tier and publisher arrived as fields in the model's own JSON and were taken
 * at face value, which meant fifty-five of the rubric's hundred points were the
 * model grading itself: it could label a personal blog `primary` and call it
 * the Associated Press, and nothing in the app would disagree. These are the
 * pieces that can be checked against the URL, which is the one thing about a
 * citation that is not up for negotiation.
 */
import type { SourceTier } from './types';

interface KnownSource {
  publisher: string;
  tier: SourceTier;
  /** Ways the same outlet is legitimately named, so a real match is not flagged. */
  aliases?: string[];
}

/**
 * Deliberately short. An unknown domain is `secondary`, which is the middle of
 * the scale and the honest answer for "no opinion" - not a penalty, and not the
 * full marks a model could previously award itself.
 */
const KNOWN: Record<string, KnownSource> = {
  'apnews.com': { publisher: 'Associated Press', tier: 'major_outlet', aliases: ['ap', 'apnews'] },
  'reuters.com': { publisher: 'Reuters', tier: 'major_outlet' },
  'bbc.com': { publisher: 'BBC', tier: 'major_outlet' },
  'bbc.co.uk': { publisher: 'BBC', tier: 'major_outlet' },
  'npr.org': { publisher: 'NPR', tier: 'major_outlet' },
  'nytimes.com': { publisher: 'The New York Times', tier: 'major_outlet', aliases: ['nyt'] },
  'washingtonpost.com': { publisher: 'The Washington Post', tier: 'major_outlet' },
  'wsj.com': { publisher: 'The Wall Street Journal', tier: 'major_outlet', aliases: ['wsj'] },
  'ft.com': { publisher: 'Financial Times', tier: 'major_outlet' },
  'theguardian.com': { publisher: 'The Guardian', tier: 'major_outlet' },
  'bloomberg.com': { publisher: 'Bloomberg', tier: 'major_outlet' },
  'economist.com': { publisher: 'The Economist', tier: 'major_outlet' },
  'cnn.com': { publisher: 'CNN', tier: 'major_outlet' },
  'nbcnews.com': { publisher: 'NBC News', tier: 'major_outlet' },
  'cbsnews.com': { publisher: 'CBS News', tier: 'major_outlet' },
  'abcnews.go.com': { publisher: 'ABC News', tier: 'major_outlet' },
  'politico.com': { publisher: 'Politico', tier: 'major_outlet' },
  'axios.com': { publisher: 'Axios', tier: 'major_outlet' },

  'mlb.com': { publisher: 'MLB', tier: 'primary' },
  'nba.com': { publisher: 'NBA', tier: 'primary' },
  'nfl.com': { publisher: 'NFL', tier: 'primary' },
  'nhl.com': { publisher: 'NHL', tier: 'primary' },
  'olympics.com': { publisher: 'the IOC', tier: 'primary' },

  'wunderground.com': { publisher: 'Weather Underground', tier: 'secondary' },
  'timeanddate.com': { publisher: 'Time and Date', tier: 'secondary' },
  'accuweather.com': { publisher: 'AccuWeather', tier: 'secondary' },

  'reddit.com': { publisher: 'Reddit', tier: 'social' },
  'x.com': { publisher: 'X', tier: 'social', aliases: ['twitter'] },
  'twitter.com': { publisher: 'X', tier: 'social', aliases: ['twitter'] },
  'facebook.com': { publisher: 'Facebook', tier: 'social' },
  'instagram.com': { publisher: 'Instagram', tier: 'social' },
  'tiktok.com': { publisher: 'TikTok', tier: 'social' },
  'youtube.com': { publisher: 'YouTube', tier: 'social' },
  'medium.com': { publisher: 'Medium', tier: 'social' },
  'substack.com': { publisher: 'Substack', tier: 'social' },
};

/**
 * Host without `www.`, which is the closest thing to a stable identity a
 * citation has. Subdomains collapse to their parent so that two pages on one
 * outlet are one source however they are served.
 */
export function registrableDomain(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }

  // Two labels is the usual answer; three when the public suffix has two parts,
  // as in .co.uk or .go.com, which would otherwise collapse to the suffix.
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const tail = parts.slice(-2).join('.');
  return TWO_PART_SUFFIXES.has(tail) ? parts.slice(-3).join('.') : tail;
}

const TWO_PART_SUFFIXES = new Set([
  'co.uk',
  'ac.uk',
  'gov.uk',
  'org.uk',
  'com.au',
  'co.nz',
  'co.jp',
  'go.com',
]);

/**
 * The tier the domain earns, ignoring whatever the model claimed.
 *
 * Any US government host counts as primary: for an official statistic, a
 * temperature record or a court filing, the agency is by definition the body
 * that would know.
 */
export function tierForUrl(url: string): SourceTier {
  const domain = registrableDomain(url);
  if (!domain) return 'secondary';
  if (domain.endsWith('.gov') || domain.endsWith('.mil')) return 'primary';
  return KNOWN[domain]?.tier ?? 'secondary';
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/\b(the|inc|llc|news|com)\b/g, '').replace(/[^a-z0-9]/g, '');
}

/**
 * A publisher name that cannot be true for this URL.
 *
 * Only ever says yes for a domain in the table, because that is the only case
 * where the app has an opinion worth having. An unknown domain claiming to be
 * anything is simply unknown, and saying otherwise would flag every legitimate
 * local outlet in the world.
 */
export function publisherMismatch(url: string, claimed: string | null): boolean {
  if (!claimed?.trim()) return false;
  const domain = registrableDomain(url);
  if (!domain) return false;

  const known = KNOWN[domain];
  if (!known) return false;

  const want = normalize(known.publisher);
  const got = normalize(claimed);
  if (!got || !want) return false;
  if (got === want || want.includes(got) || got.includes(want)) return false;

  const aliases = [...(known.aliases ?? []), domain.split('.')[0] ?? ''].map(normalize);
  return !aliases.some((alias) => alias && (alias === got || got.includes(alias)));
}
