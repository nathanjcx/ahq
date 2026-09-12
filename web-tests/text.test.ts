import { describe, expect, it } from 'vitest';
import { durationLabel, hourLabel, relativeTime, shortDate, shortTime } from '../components/shared/time';
import { clip, firstSentence, normalizeWhitespace, pluralize, slug } from '../lib/text';

describe('normalizeWhitespace', () => {
  it('collapses every run of whitespace and trims the ends', () => {
    expect(normalizeWhitespace('  a\n\n b\t\tc  ')).toBe('a b c');
  });
});

describe('clip', () => {
  it('leaves text that already fits', () => {
    expect(clip('short', 10)).toBe('short');
    expect(clip('exactly ten', 11)).toBe('exactly ten');
  });

  it('never exceeds the limit, counting the ellipsis', () => {
    const clipped = clip('abcdefghij', 5);
    expect(clipped).toBe('abcd…');
    expect(clipped).toHaveLength(5);
  });

  it('does not leave a space before the ellipsis', () => {
    expect(clip('one two three', 8)).toBe('one two…');
  });

  it('returns nothing for a limit of zero or less', () => {
    expect(clip('anything', 0)).toBe('');
  });
});

describe('firstSentence', () => {
  it('stops at the first terminator and keeps it', () => {
    expect(firstSentence('Ran the migration. Then checked it.', 100)).toBe('Ran the migration.');
    expect(firstSentence('Did it work? I think so.', 100)).toBe('Did it work?');
  });

  it('treats text with no terminator as one sentence', () => {
    expect(firstSentence('no terminator here', 100)).toBe('no terminator here');
  });

  it('ignores a period inside a number or an abbreviation', () => {
    expect(firstSentence('It cost 1.5 tokens. Fine.', 100)).toBe('It cost 1.5 tokens.');
  });

  it('collapses newlines and clips a long sentence', () => {
    expect(firstSentence('a very\nlong opening line with no end', 12)).toBe('a very long…');
  });
});

describe('slug', () => {
  it('lowercases and hyphenates', () => {
    expect(slug('Marketplace admin')).toBe('marketplace-admin');
    expect(slug('Floor 1 · Release desk')).toBe('floor-1-release-desk');
  });

  it('leaves no leading or trailing hyphen', () => {
    expect(slug('  —Spring launch!  ')).toBe('spring-launch');
  });
});

describe('pluralize', () => {
  it('agrees with the count', () => {
    expect(pluralize(1, 'task')).toBe('1 task');
    expect(pluralize(0, 'task')).toBe('0 tasks');
    expect(pluralize(3, 'task')).toBe('3 tasks');
  });

  it('takes an irregular plural', () => {
    expect(pluralize(1, 'person', 'people')).toBe('1 person');
    expect(pluralize(4, 'person', 'people')).toBe('4 people');
  });

  it('groups a large count', () => {
    expect(pluralize(12_000, 'entry', 'entries')).toBe('12,000 entries');
  });
});

describe('relativeTime', () => {
  const now = Date.now();

  it('names the recent past in the shortest form that says it', () => {
    expect(relativeTime(now)).toBe('just now');
    expect(relativeTime(now - 30_000)).toBe('just now');
    expect(relativeTime(now - 12 * 60_000)).toBe('12m ago');
    expect(relativeTime(now - 3 * 3_600_000)).toBe('3h ago');
    expect(relativeTime(now - 2 * 86_400_000)).toBe('2d ago');
  });

  it('falls back to a date after a week', () => {
    const old = now - 30 * 86_400_000;
    expect(relativeTime(old)).toBe(shortDate(old));
  });
});

describe('durationLabel', () => {
  it('scales its unit to the length', () => {
    expect(durationLabel(820)).toBe('820 ms');
    expect(durationLabel(1_400)).toBe('1.4 s');
    expect(durationLabel(200_000)).toBe('3m 20s');
    expect(durationLabel(8_100_000)).toBe('2h 15m');
  });
});

describe('shortTime', () => {
  it('shows an hour and a minute and no date', () => {
    expect(shortTime(Date.UTC(2026, 8, 12, 14, 32))).toMatch(/\d{1,2}[:.]\d{2}/);
  });
});

describe('hourLabel', () => {
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;

  it('reads a whole hour off the clock', () => {
    expect(hourLabel(9, here)).toBe(
      new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: 'UTC' }).format(
        Date.UTC(2001, 0, 1, 9),
      ),
    );
  });

  it('names the zone when it is not the viewer’s own', () => {
    const elsewhere = here === 'Asia/Tokyo' ? 'America/New_York' : 'Asia/Tokyo';
    expect(hourLabel(9, elsewhere)).toMatch(/\s\S+$/);
  });
});
