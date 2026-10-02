import { describe, expect, it } from 'vitest';
import { FakeLlm, FakeStt, FakeTts, cannedReply } from '../src/pipeline/fakes.js';
import { simulate } from '../src/simulate.js';

describe('streaming pipeline', () => {
  it('starts speaking before the LLM finishes, with small gaps between sentences', async () => {
    const delays = { sttMs: 20, llmFirstMs: 40, llmDeltaMs: 60, ttsMs: 30 };
    const r = await simulate({
      pcm: new Int16Array(16000),
      delays,
      stt: new FakeStt('hello there buddy', delays.sttMs),
      llm: new FakeLlm(cannedReply, delays),
      tts: new FakeTts(delays.ttsMs),
    });
    const at = (ev: string, nth = 0): number => r.timeline.filter((e) => e.event === ev)[nth]!.tMs;
    const queued = r.timeline.filter((e) => e.event === 'audio-queued').map((e) => e.tMs);
    expect(queued.length).toBeGreaterThanOrEqual(2);
    expect(queued[0]).toBeLessThan(at('llm-done')); // first audio lands while the LLM is still streaming
    for (let i = 1; i < queued.length; i++) expect(queued[i]! - queued[i - 1]!).toBeLessThanOrEqual(300);
    expect(r.audio.length).toBe(queued.length);
  });
});
