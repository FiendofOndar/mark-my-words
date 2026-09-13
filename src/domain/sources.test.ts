import { describe, expect, it } from 'vitest';
import { publisherMismatch, registrableDomain, tierForUrl } from './sources';

describe('registrable domain', () => {
  it('strips www and subdomains so one outlet counts once', () => {
    expect(registrableDomain('https://www.apnews.com/article/one')).toBe('apnews.com');
    expect(registrableDomain('https://forecast.weather.gov/MapClick.php?x=1')).toBe('weather.gov');
    expect(registrableDomain('https://api.weather.gov/points/48,-122')).toBe('weather.gov');
  });

  it('keeps a label when the suffix has two parts', () => {
    expect(registrableDomain('https://www.bbc.co.uk/news/x')).toBe('bbc.co.uk');
    expect(registrableDomain('https://abcnews.go.com/US/story')).toBe('abcnews.go.com');
  });

  it('says nothing about a URL it cannot parse', () => {
    expect(registrableDomain('not a url')).toBeNull();
  });
});

describe('tier from the domain', () => {
  it('treats a government host as the body that would know', () => {
    // The agency that records the temperature is primary on that temperature,
    // whatever the model wants to call itself.
    expect(tierForUrl('https://forecast.weather.gov/x')).toBe('primary');
    expect(tierForUrl('https://www.bls.gov/news.release/cpi.htm')).toBe('primary');
  });

  it('knows a wire service from a forum', () => {
    expect(tierForUrl('https://apnews.com/article/one')).toBe('major_outlet');
    expect(tierForUrl('https://www.reddit.com/r/x/comments/y')).toBe('social');
  });

  it('gives an unknown domain the middle of the scale, not the top', () => {
    // This is the one that mattered: `tier` came straight out of the model's
    // JSON, so a blog could be filed as primary and score the full 25.
    expect(tierForUrl('https://some-guys-blog.example/post')).toBe('secondary');
  });
});

describe('publisher against host', () => {
  it('accepts an outlet named any of the ways it is really named', () => {
    expect(publisherMismatch('https://apnews.com/a', 'Associated Press')).toBe(false);
    expect(publisherMismatch('https://apnews.com/a', 'AP')).toBe(false);
    expect(publisherMismatch('https://www.nytimes.com/a', 'The New York Times')).toBe(false);
    expect(publisherMismatch('https://www.bbc.co.uk/a', 'BBC')).toBe(false);
  });

  it('catches a name that cannot be true for the host', () => {
    expect(publisherMismatch('https://some-guys-blog.example/a', 'Associated Press')).toBe(false);
    expect(publisherMismatch('https://www.reddit.com/r/x', 'Reuters')).toBe(true);
    expect(publisherMismatch('https://wunderground.com/a', 'National Weather Service')).toBe(true);
  });

  it('stays quiet when it has no opinion', () => {
    // An unknown domain claiming to be a local paper is simply unknown. Saying
    // otherwise would flag every legitimate small outlet there is.
    expect(publisherMismatch('https://skagitvalleyherald.example/a', 'Skagit Valley Herald')).toBe(
      false,
    );
    expect(publisherMismatch('https://apnews.com/a', null)).toBe(false);
    expect(publisherMismatch('not a url', 'AP')).toBe(false);
  });
});
