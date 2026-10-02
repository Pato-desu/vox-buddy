import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { startSession } from '../src/session.js';
import { FakeLlm, FakeStt, FakeTts } from '../src/pipeline/fakes.js';
import type { ReceiverLike } from '../src/voice/receive.js';
import type { AudioChunk, Stt } from '../src/pipeline/types.js';

const CAPTURE = { silenceEndMs: 800, minUtteranceMs: 400, maxUtteranceMs: 20_000, energyGate: 500 };

function burst(ms: number, amp: number): Buffer {
  const frames = (48000 * ms) / 1000;
  const a = new Int16Array(frames * 2);
  for (let i = 0; i < frames; i++) a[i * 2] = a[i * 2 + 1] = Math.round(amp * Math.sin((i * 2 * Math.PI * 220) / 48000));
  return Buffer.from(a.buffer);
}

function fakeReceiver() {
  let onStart: (id: string) => void = () => {};
  const streams = new Map<string, PassThrough>();
  const receiver: ReceiverLike = {
    onSpeakingStart: (l) => (onStart = l),
    subscribePcm: (id) => streams.set(id, new PassThrough()).get(id)!,
  };
  const speak = (id: string): void => {
    onStart(id);
    streams.get(id)!.write(burst(1000, 6000));
    streams.get(id)!.write(burst(900, 0));
  };
  return { receiver, speak };
}

describe('startSession', () => {
  it('answers two speakers in arrival order, once each', async () => {
    const { receiver, speak } = fakeReceiver();
    const played: AudioChunk[] = [];
    const replies: string[] = [];
    const s = startSession({
      receiver,
      stt: new FakeStt('hello there friend'),
      llm: new FakeLlm((t) => { replies.push(t.speaker); return [`Hi ${t.speaker}, nice to meet you.`]; }),
      tts: new FakeTts(),
      player: { enqueue: (c) => played.push(c), stop() {} },
      capture: CAPTURE,
      minSentenceChars: 12,
      resolveSpeaker: (id) => ({ userId: id, userName: id.toUpperCase(), isBot: false }),
    });
    speak('a');
    speak('b');
    await s.whenIdle();
    expect(replies).toEqual(['A', 'B']);
    expect(played).toHaveLength(2);
  });

  it('survives a failing STT turn and handles the next one', async () => {
    const { receiver, speak } = fakeReceiver();
    let n = 0;
    const stt: Stt = { transcribe: async () => { if (n++ === 0) throw new Error('sidecar down'); return 'second try works'; } };
    const logs: string[] = [];
    const played: AudioChunk[] = [];
    const s = startSession({
      receiver, stt,
      llm: new FakeLlm(() => ['All good now, friend.']),
      tts: new FakeTts(),
      player: { enqueue: (c) => played.push(c), stop() {} },
      capture: CAPTURE, minSentenceChars: 12,
      resolveSpeaker: (id) => ({ userId: id, userName: id, isBot: false }),
      log: (m) => logs.push(m),
    });
    speak('a');
    speak('b');
    await s.whenIdle();
    expect(logs.some((l) => l.includes('turn failed'))).toBe(true);
    expect(played).toHaveLength(1);
  });
});
