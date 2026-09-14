import { describe, expect, it } from 'vitest';
import { fetchPostText, parseRedditListing, parseXEmbed, postTextSupported } from './postText';

/**
 * The response shapes here are written from memory of the two public
 * endpoints; the build container cannot reach either host. They pin the
 * parser, not the endpoint. If a real response differs, capture it and
 * replace these fixtures.
 */
describe('which links carry their own words', () => {
  it('recognises an X status and a Reddit post, and nothing else', () => {
    expect(postTextSupported('https://x.com/NASA/status/1928129456040046834')).toBe('x');
    expect(postTextSupported('https://twitter.com/NASA/status/1928129456040046834?s=20')).toBe('x');
    expect(postTextSupported('https://www.reddit.com/r/space/comments/1kz6f0v/title_here/')).toBe('reddit');
    expect(postTextSupported('https://www.instagram.com/reel/abc123/')).toBeNull();
    expect(postTextSupported('https://x.com/NASA')).toBeNull();
    expect(postTextSupported('not a url')).toBeNull();
  });
});

describe('reading an X embed', () => {
  it('takes the words, the handle and the date out of the blockquote', () => {
    const html =
      '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Mark my words, the Mariners win it all this year &amp; nobody will be surprised<br>Book it.</p>&mdash; Jordan (@fiend) <a href="https://twitter.com/fiend/status/1">March 3, 2026</a></blockquote>';
    expect(parseXEmbed({ html, author_name: 'Jordan' })).toEqual({
      text: 'Mark my words, the Mariners win it all this year & nobody will be surprised\nBook it.',
      author: '@fiend',
      postedOn: '2026-03-03',
    });
  });

  it('returns null for anything that is not an embed', () => {
    expect(parseXEmbed({ error: 'not found' })).toBeNull();
    expect(parseXEmbed(null)).toBeNull();
  });
});

describe('reading a Reddit listing', () => {
  const listing = [
    {
      data: {
        children: [
          {
            data: {
              title: 'Artemis II flies before the end of 2025. Mark my words.',
              selftext: 'The stacking is done, nothing left to wait on.',
              author: 'rocketguy',
              created_utc: 1736510400,
            },
          },
        ],
      },
    },
    { data: { children: [] } },
  ];

  it('joins the title and the body and names the poster', () => {
    expect(parseRedditListing(listing)).toEqual({
      text: 'Artemis II flies before the end of 2025. Mark my words.\n\nThe stacking is done, nothing left to wait on.',
      author: 'u/rocketguy',
      postedOn: '2025-01-10',
    });
  });

  it('drops a removed body and keeps the title', () => {
    const removed = JSON.parse(JSON.stringify(listing));
    removed[0].data.children[0].data.selftext = '[removed]';
    expect(parseRedditListing(removed)?.text).toBe('Artemis II flies before the end of 2025. Mark my words.');
  });
});

describe('fetching', () => {
  it('asks Reddit for the JSON form of the post and never throws', async () => {
    const seen: string[] = [];
    const http = {
      get: async (url: string) => {
        seen.push(url);
        return { status: 500, text: 'nope', finalUrl: url };
      },
    };
    expect(await fetchPostText('https://www.reddit.com/r/space/comments/1kz6f0v/x/?utm=1', http)).toBeNull();
    expect(seen[0]).toBe('https://www.reddit.com/r/space/comments/1kz6f0v/x.json?limit=1&raw_json=1');
  });
});
