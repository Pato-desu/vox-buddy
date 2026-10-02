import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ConversationMemory } from '../src/brain/memory.js';
import { FakeTts } from '../src/pipeline/fakes.js';
import { LatencyRecorder } from '../src/pipeline/metrics.js';
import type { Llm } from '../src/pipeline/types.js';
import { startSession } from '../src/session.js';
import { PlaybackQueue } from '../src/voice/playback.js';
import type { ReceiverLike } from '../src/voice/receive.js';

const CAPTURE = { silenceEndMs: 800, minUtteranceMs: 400, maxUtteranceMs: 20_000, energyGate: 500 };
const tone = (ms: number, amp: number): Buffer => {
  const n = (48000 * ms) / 1000;
  const a = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) a[i * 2] = a[i * 2 + 1] = Math.round(amp * Math.sin((i * 2 * Math.PI * 220) / 48000));
  return Buffer.from(a.buffer);
};
/** Small seeded PRNG so a failing soak run can be replayed. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('simulated soak', () => {
  for (const mode of ['stop', 'sentence', 'never'] as const) {
    it(`200 turns with random overlaps and faults (barge-in: ${mode})`, async () => {
      const rand = rng(42);
      const unhandled: unknown[] = [];
      const onUnhandled = (e: unknown): void => void unhandled.push(e);
      process.on('unhandledRejection', onUnhandled);

      let onStart: (id: string) => void = () => {};
      const streams = new Map<string, PassThrough>();
      const receiver: ReceiverLike = { onSpeakingStart: (l) => (onStart = l), subscribePcm: (id) => streams.set(id, new PassThrough()).get(id)! };

      const faults = { stt: 0, llm: 0, tts: 0 };
      let played = 0;
      let playing = 0;
      let maxConcurrent = 0;
      const sink = {
        play: async () => {
          playing++;
          maxConcurrent = Math.max(maxConcurrent, playing);
          await sleep(1);
          playing--;
          played++;
        },
        stop() {},
      };
      const llm: Llm = {
        async *stream(turn, signal) {
          await sleep(rand() * 3);
          if (rand() < 0.1) {
            faults.llm++;
            throw new Error('429');
          }
          for (const s of [`Sure ${turn.speaker}. `, 'Here is a second sentence. ', 'And a third one for luck.']) {
            if (signal?.aborted) return;
            await sleep(rand() * 2);
            yield s;
          }
        },
      };
      const tts = new FakeTts(1);
      const memory = new ConversationMemory(20);
      const latency = new LatencyRecorder();
      const queue = new PlaybackQueue(sink);
      const logs: string[] = [];
      const s = startSession({
        receiver,
        stt: {
          transcribe: async () => {
            await sleep(rand() * 3);
            const r = rand();
            if (r < 0.1) {
              faults.stt++;
              throw new Error('sidecar down');
            }
            return r < 0.2 ? 'uh' : 'hey buddy what is going on';
          },
        },
        llm,
        tts: {
          synthesize: async (text) => {
            if (rand() < 0.05) {
              faults.tts++;
              throw new Error('tts failed');
            }
            return tts.synthesize(text);
          },
        },
        player: queue,
        capture: CAPTURE,
        minSentenceChars: 8,
        bargeIn: mode,
        memory,
        latency,
        replyWordHardCap: 80,
        hearingErrorLine: "Can't hear you.",
        resolveSpeaker: (id) => ({ userId: id, userName: id, isBot: id === 'bot' }),
        log: (m) => logs.push(m),
      });

      const users = ['a', 'b', 'c', 'd', 'bot'];
      for (let i = 0; i < 200; i++) {
        const id = users[Math.floor(rand() * users.length)]!;
        onStart(id);
        const st = streams.get(id);
        st?.write(tone(1000, 6000));
        st?.write(tone(900, 0));
        if (rand() < 0.5) await sleep(rand() * 4); // sometimes overlap, sometimes space out
        if (i === 100) s.setHushed(true);
        if (i === 110) s.setHushed(false);
      }

      const idle = await Promise.race([s.whenIdle().then(() => 'idle'), sleep(20_000).then(() => 'hung')]);
      expect(idle).toBe('idle'); // no hang
      await sleep(30);
      process.off('unhandledRejection', onUnhandled);

      expect(unhandled).toEqual([]);
      expect(faults.stt + faults.llm + faults.tts).toBeGreaterThan(5); // the faults really happened
      expect(played).toBeGreaterThan(20); // and the bot kept talking anyway
      expect(maxConcurrent).toBe(1); // never two things playing at once
      expect(queue.pending).toBe(0);
      expect(memory.size).toBeLessThanOrEqual(20); // history stays bounded
      expect(logs.length).toBeLessThan(400); // no log storms
    }, 30_000);
  }
});
