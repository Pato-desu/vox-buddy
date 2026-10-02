import { describe, expect, it } from 'vitest';
import { simulate } from '../src/simulate.js';
import { tuning } from '../src/config.js';

describe('simulate', () => {
  it('produces a timeline in pipeline order with the first word inside the latency budget', async () => {
    const r = await simulate({ pcm: new Int16Array(24000) });
    expect(r.heard).toBe('hello buddy, that was 1.5 seconds');
    expect(r.sentences).toEqual(['Hey Alex, good to hear you.', 'What are we getting into today?']);
    const order = r.timeline.map((e) => e.event);
    expect(order.indexOf('heard')).toBeLessThan(order.indexOf('llm-first-delta'));
    expect(order.indexOf('llm-first-delta')).toBeLessThan(order.indexOf('sentence'));
    expect(order.indexOf('sentence')).toBeLessThan(order.indexOf('audio-queued'));
    expect(r.audio).toHaveLength(2);
    expect(r.firstWordMs).not.toBeNull();
    expect(r.firstWordMs!).toBeLessThan(tuning.latencyBudgetMs.firstWord);
  });
});
