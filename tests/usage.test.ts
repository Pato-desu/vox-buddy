import { describe, expect, it } from 'vitest';
import { normalizeSettings } from '../src/settings.js';
import { UsageTracker, dayKey, formatUsage, normalizeDayUsage, type DayUsage, type UsageStore } from '../src/usage.js';

const u = (promptTokens: number, outputTokens: number, thinkingTokens = 0) => ({ promptTokens, outputTokens, thinkingTokens });
const at = (iso: string): number => new Date(iso).getTime(); // local time, like dayKey

function memStore(initial: DayUsage | null = null) {
  const s = { saved: initial, saves: 0 };
  const store: UsageStore = { load: () => s.saved, save: (d) => ((s.saved = d), void s.saves++) };
  return { s, store };
}

describe('UsageTracker', () => {
  it('adds up this run and today, and saves today after each reply', () => {
    const { s, store } = memStore();
    let now = at('2026-10-04T10:00:00');
    const t = new UsageTracker(store, () => now);
    t.record(u(115, 12));
    now += 5000;
    t.record(u(130, 20, 8));
    const snap = t.snapshot();
    expect(snap.run).toEqual({ requests: 2, promptTokens: 245, outputTokens: 32, thinkingTokens: 8 });
    expect(snap.today).toEqual({ day: '2026-10-04', requests: 2, promptTokens: 245, outputTokens: 32, thinkingTokens: 8 });
    expect(s.saves).toBe(2);
    expect(s.saved).toEqual(snap.today);
  });

  it('picks up today from a restart, but starts fresh when the saved day is old', () => {
    const now = at('2026-10-04T10:00:00');
    const same = new UsageTracker(memStore({ day: '2026-10-04', requests: 5, promptTokens: 500, outputTokens: 50, thinkingTokens: 0 }).store, () => now);
    expect(same.snapshot().today.requests).toBe(5);
    expect(same.snapshot().run.requests).toBe(0); // "this run" always starts at zero
    const old = new UsageTracker(memStore({ day: '2026-10-03', requests: 5, promptTokens: 500, outputTokens: 50, thinkingTokens: 0 }).store, () => now);
    expect(old.snapshot().today).toEqual({ day: '2026-10-04', requests: 0, promptTokens: 0, outputTokens: 0, thinkingTokens: 0 });
  });

  it('rolls over at local midnight while running', () => {
    let now = at('2026-10-04T23:59:30');
    const t = new UsageTracker(undefined, () => now);
    t.record(u(100, 10));
    now = at('2026-10-05T00:00:10');
    t.record(u(200, 20));
    const snap = t.snapshot();
    expect(snap.today).toEqual({ day: '2026-10-05', requests: 1, promptTokens: 200, outputTokens: 20, thinkingTokens: 0 });
    expect(snap.run.requests).toBe(2);
  });

  it('the last-minute window forgets older replies', () => {
    let now = at('2026-10-04T10:00:00');
    const t = new UsageTracker(undefined, () => now);
    t.record(u(100, 10));
    now += 30_000;
    t.record(u(50, 5));
    expect(t.snapshot().lastMinute).toMatchObject({ requests: 2, promptTokens: 150 });
    now += 31_000; // the first reply is now 61 s old
    expect(t.snapshot().lastMinute).toMatchObject({ requests: 1, promptTokens: 50 });
    now += 60_000;
    expect(t.snapshot().lastMinute.requests).toBe(0);
  });
});

describe('stored usage is validated', () => {
  it('normalizeDayUsage drops bad numbers and other days', () => {
    expect(normalizeDayUsage({ day: '2026-10-04', requests: -3, promptTokens: 'x', outputTokens: 7.9, thinkingTokens: NaN }, '2026-10-04')).toEqual({ day: '2026-10-04', requests: 0, promptTokens: 0, outputTokens: 7, thinkingTokens: 0 });
    expect(normalizeDayUsage({ day: '2026-10-03', requests: 9 }, '2026-10-04').requests).toBe(0);
    expect(normalizeDayUsage('junk', '2026-10-04').requests).toBe(0);
  });

  it('settings keep a well-formed usage record and drop anything else', () => {
    expect(normalizeSettings({ usage: { day: '2026-10-04', requests: 2, promptTokens: 10, outputTokens: 4, thinkingTokens: 0 } }).usage).toEqual({ day: '2026-10-04', requests: 2, promptTokens: 10, outputTokens: 4, thinkingTokens: 0 });
    expect(normalizeSettings({ usage: { day: 'yesterday', requests: 2 } }).usage).toBeNull();
    expect(normalizeSettings({ usage: 5 }).usage).toBeNull();
    expect(normalizeSettings({}).usage).toBeNull();
  });

  it('dayKey is the local calendar date', () => {
    expect(dayKey(at('2026-01-02T03:04:05'))).toBe('2026-01-02');
  });
});

describe('formatUsage', () => {
  it('shows run, today, last minute, the average, and where the real quota lives', () => {
    const now = at('2026-10-04T10:00:00');
    const t = new UsageTracker(undefined, () => now);
    t.record(u(115, 12));
    t.record(u(135, 18, 6));
    const text = formatUsage(t.snapshot(), 'gemini-3.5-flash-lite');
    expect(text).toContain('Gemini model: gemini-3.5-flash-lite');
    expect(text).toContain('This run: 2 replies, 286 tokens (250 in, 36 out (6 of it thinking))');
    expect(text).toContain('Today (local time): 2 replies');
    expect(text).toContain('Last minute: 2 replies');
    expect(text).toContain('Average reply this run: about 143 tokens');
    expect(text).toContain('aistudio.google.com/usage');
  });

  it('copes with nothing used yet, and never contains transcript-like data', () => {
    const text = formatUsage(new UsageTracker(undefined, () => 0).snapshot(), 'm');
    expect(text).toContain('This run: 0 replies, 0 tokens');
    expect(text).not.toContain('Average reply');
  });
});
