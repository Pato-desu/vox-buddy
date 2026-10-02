import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AloneWatcher } from '../src/voice/alone.js';

describe('AloneWatcher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('leaves after the alone period', () => {
    const onLeave = vi.fn();
    const w = new AloneWatcher({ afterMs: 300_000, onLeave });
    w.humansPresent(0);
    vi.advanceTimersByTime(299_000);
    expect(onLeave).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
  it('someone returning cancels it, and repeated empty updates do not restart the clock', () => {
    const onLeave = vi.fn();
    const w = new AloneWatcher({ afterMs: 1000, onLeave });
    w.humansPresent(0);
    vi.advanceTimersByTime(600);
    w.humansPresent(0); // same state again
    vi.advanceTimersByTime(400);
    expect(onLeave).toHaveBeenCalledTimes(1);
    const w2 = new AloneWatcher({ afterMs: 1000, onLeave });
    w2.humansPresent(0);
    vi.advanceTimersByTime(500);
    w2.humansPresent(2);
    vi.advanceTimersByTime(5000);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
  it('stop() frees the timer and nothing fires later', () => {
    const onLeave = vi.fn();
    const w = new AloneWatcher({ afterMs: 1000, onLeave });
    w.humansPresent(0);
    w.stop();
    vi.advanceTimersByTime(5000);
    expect(onLeave).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
