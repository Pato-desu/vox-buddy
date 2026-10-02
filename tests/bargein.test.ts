import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { FakeLlm, FakeStt, FakeTts } from '../src/pipeline/fakes.js';
import { startSession } from '../src/session.js';
import { PlaybackQueue } from '../src/voice/playback.js';
import type { BargeInMode } from '../src/config.js';
import type { AudioChunk } from '../src/pipeline/types.js';
import type { ReceiverLike } from '../src/voice/receive.js';

const CAPTURE = { silenceEndMs: 800, minUtteranceMs: 400, maxUtteranceMs: 20_000, energyGate: 500 };
const tone = (ms: number, amp: number): Buffer => {
  const n = (48000 * ms) / 1000;
  const a = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) a[i * 2] = a[i * 2 + 1] = Math.round(amp * Math.sin((i * 2 * Math.PI * 220) / 48000));
  return Buffer.from(a.buffer);
};

/** A sink where each chunk "plays" until released, so tests control playback by hand. */
function manualSink() {
  const played: AudioChunk[] = [];
  let release: (() => void) | null = null;
  let stops = 0;
  return {
    played,
    get stops() {
      return stops;
    },
    finishCurrent: () => release?.(),
    sink: {
      play: (c: AudioChunk) => new Promise<void>((r) => (played.push(c), (release = r))),
      stop: () => (stops++, release?.()),
    },
  };
}

function rig(mode: BargeInMode) {
  let onStart: (id: string) => void = () => {};
  const streams = new Map<string, PassThrough>();
  const receiver: ReceiverLike = { onSpeakingStart: (l) => (onStart = l), subscribePcm: (id) => streams.set(id, new PassThrough()).get(id)! };
  const m = manualSink();
  const queue = new PlaybackQueue(m.sink);
  const replies: string[] = [];
  const s = startSession({
    receiver,
    stt: new FakeStt('hey buddy tell me something'),
    llm: new FakeLlm((t) => (replies.push(t.speaker), [`First sentence for ${t.speaker}. `, 'Second sentence follows here. ', 'Third one to end.'])),
    tts: new FakeTts(),
    player: queue,
    capture: CAPTURE,
    minSentenceChars: 12,
    bargeIn: mode,
    resolveSpeaker: (id) => ({ userId: id, userName: id, isBot: false }),
  });
  const startSpeaking = (id: string): void => onStart(id);
  const speak = (id: string): void => {
    startSpeaking(id);
    streams.get(id)!.write(tone(1000, 6000));
    streams.get(id)!.write(tone(900, 0));
  };
  return { s, speak, startSpeaking, queue, m, replies };
}
const tick = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('barge-in', () => {
  it('stop: speech start halts playback at once, clears the queue, and the interrupter is answered next', async () => {
    const r = rig('stop');
    r.speak('a');
    await tick(150); // reply is playing sentence 1, the rest is queued
    expect(r.queue.playing).toBe(true);
    r.startSpeaking('b'); // b interrupts
    expect(r.m.stops).toBe(1); // stopped synchronously, well inside the 300 ms budget
    expect(r.queue.pending).toBe(0);
    r.speak('b');
    await tick(200);
    expect(r.replies).toEqual(['a', 'b']); // b's utterance handled next
    for (let i = 0; i < 10; i++) {
      r.m.finishCurrent(); // let b's reply play out chunk by chunk
      await tick(5);
    }
    await r.s.whenIdle();
  });
  it('sentence: the playing sentence finishes but nothing else is queued', async () => {
    const r = rig('sentence');
    r.speak('a');
    await tick(150);
    r.startSpeaking('b');
    expect(r.m.stops).toBe(0);
    expect(r.queue.pending).toBe(0);
    expect(r.queue.playing).toBe(true);
    r.m.finishCurrent();
    await tick();
    expect(r.queue.playing).toBe(false);
    expect(r.m.played).toHaveLength(1);
  });
  it('never: interruptions are ignored', async () => {
    const r = rig('never');
    r.speak('a');
    await tick(150);
    r.startSpeaking('b');
    expect(r.m.stops).toBe(0);
    expect(r.queue.pending).toBeGreaterThan(0);
  });
  it('ignores speech when the bot is quiet', async () => {
    const r = rig('stop');
    r.startSpeaking('b');
    expect(r.m.stops).toBe(0);
  });
});
