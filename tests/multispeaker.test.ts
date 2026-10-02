import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { FakeLlm, FakeStt, FakeTts } from '../src/pipeline/fakes.js';
import { startSession } from '../src/session.js';
import type { ReceiverLike } from '../src/voice/receive.js';

const CAPTURE = { silenceEndMs: 800, minUtteranceMs: 400, maxUtteranceMs: 20_000, energyGate: 500 };
const tone = (ms: number, amp: number): Buffer => {
  const n = (48000 * ms) / 1000;
  const a = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) a[i * 2] = a[i * 2 + 1] = Math.round(amp * Math.sin((i * 2 * Math.PI * 220) / 48000));
  return Buffer.from(a.buffer);
};

describe('multi-speaker queue', () => {
  it('answers overlapping speakers in arrival order, one reply at a time, no duplicates', async () => {
    let onStart: (id: string) => void = () => {};
    const streams = new Map<string, PassThrough>();
    const receiver: ReceiverLike = { onSpeakingStart: (l) => (onStart = l), subscribePcm: (id) => streams.set(id, new PassThrough()).get(id)! };
    const events: string[] = [];
    let current = '';
    const s = startSession({
      receiver,
      stt: new FakeStt('hey buddy are you there', 10),
      llm: new FakeLlm((t) => {
        current = t.speaker;
        return [`One for ${t.speaker}. `, `Two for ${t.speaker}.`];
      }, { llmFirstMs: 15, llmDeltaMs: 15 }),
      tts: new FakeTts(5),
      player: { enqueue: () => events.push(current), stop() {} },
      capture: CAPTURE,
      minSentenceChars: 8,
      bargeIn: 'never',
      resolveSpeaker: (id) => ({ userId: id, userName: id, isBot: false }),
    });
    for (const id of ['a', 'b', 'c']) {
      onStart(id);
      streams.get(id)!.write(tone(1000, 6000));
      streams.get(id)!.write(tone(900, 0));
    }
    await s.whenIdle();
    expect(events).toEqual(['a', 'a', 'b', 'b', 'c', 'c']); // never interleaved
  });
});
