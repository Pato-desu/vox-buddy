import { describe, expect, it } from 'vitest';
import { tuning } from '../src/config.js';
import { REALISTIC_DELAYS, FakeLlm, FakeStt, FakeTts, cannedReply } from '../src/pipeline/fakes.js';
import { LatencyRecorder } from '../src/pipeline/metrics.js';
import { simulate } from '../src/simulate.js';

describe('latency budget (SPEC §5)', () => {
  it('first word lands within the budget with realistic fake delays, and each stage fits its share', async () => {
    const latency = new LatencyRecorder();
    const r = await simulate({ pcm: new Int16Array(24000), latency });
    expect(r.firstWordMs).not.toBeNull();
    expect(r.firstWordMs!).toBeLessThanOrEqual(tuning.latencyBudgetMs.firstWord);
    const t = latency.last()!;
    expect(t.sttMs).toBeLessThanOrEqual(tuning.latencyBudgetMs.stt);
    expect(t.firstLlmSentenceMs).toBeLessThanOrEqual(tuning.latencyBudgetMs.firstLlmSentence);
    expect(t.firstTtsAudioMs).toBeLessThanOrEqual(tuning.latencyBudgetMs.firstTtsAudio);
  });

  it('streaming is what keeps it in budget: waiting for the whole reply would not fit', async () => {
    // Same delays, but the LLM delivers everything in one piece at the end (no sentence streaming).
    const d = REALISTIC_DELAYS;
    const blocking = await simulate({
      pcm: new Int16Array(24000),
      stt: new FakeStt('hello buddy', d.sttMs),
      llm: new FakeLlm((turn) => [cannedReply(turn).join('')], { llmFirstMs: d.llmFirstMs + 3 * d.llmDeltaMs, llmDeltaMs: 0 }),
      tts: new FakeTts(d.ttsMs * 2), // synthesizing the whole reply in one go takes longer than one sentence
    });
    const streaming = await simulate({ pcm: new Int16Array(24000) });
    expect(streaming.firstWordMs!).toBeLessThan(blocking.firstWordMs!);
  });
});
