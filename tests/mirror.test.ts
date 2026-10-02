import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranscriptMirror } from '../src/mirror.js';

describe('TranscriptMirror', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('posts heard/said lines', async () => {
    const posts: string[] = [];
    const m = new TranscriptMirror({ post: async (t) => void posts.push(t) });
    m.turn('Alex', 'hey buddy', 'Hey Alex!');
    await vi.advanceTimersByTimeAsync(0);
    expect(posts).toEqual(['**Alex:** hey buddy\n**Buddy:** Hey Alex!']);
  });

  it('rate limits: a burst becomes one batched message per interval', async () => {
    const posts: string[] = [];
    const m = new TranscriptMirror({ post: async (t) => void posts.push(t), minIntervalMs: 4000, now: () => Date.now() });
    m.turn('A', 'one', 'r1');
    await vi.advanceTimersByTimeAsync(0); // first goes out at once
    m.turn('B', 'two', 'r2');
    m.turn('C', 'three', 'r3');
    await vi.advanceTimersByTimeAsync(3000);
    expect(posts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(posts).toHaveLength(2);
    expect(posts[1]).toContain('two');
    expect(posts[1]).toContain('three');
  });

  it('drops the oldest when the queue overflows and survives a failing post', async () => {
    const errors: string[] = [];
    const posts: string[] = [];
    let fail = true;
    const m = new TranscriptMirror({
      post: async (t) => {
        if (fail) throw new Error('403');
        posts.push(t);
      },
      maxQueued: 2,
      minIntervalMs: 1000,
      now: () => Date.now(),
      onError: (e) => errors.push(e.message),
    });
    m.turn('A', 'a', 'x');
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toEqual(['403']);
    fail = false;
    for (const n of ['1', '2', '3']) m.turn('B', n, 'y');
    expect(m.pending).toBe(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(posts[0]).not.toContain('**B:** 1\n');
    expect(posts[0]).toContain('**B:** 3');
  });
});
