import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { GeminiLlm } from '../src/brain/llm.js';
import type { Transport } from '../src/brain/gemini.js';
import { FakeLlm, FakeTts } from '../src/pipeline/fakes.js';
import { startSession } from '../src/session.js';
import type { ReceiverLike } from '../src/voice/receive.js';

async function say(llm: GeminiLlm): Promise<string> {
  let s = '';
  for await (const d of llm.stream({ speaker: 'A', text: 'hi' })) s += d;
  return s;
}

describe('Gemini failure apologies', () => {
  const status = (n: number): Transport => () => ({
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(Object.assign(new Error('boom'), { status: n })) }),
  });
  const make = (transport: Transport, now: () => number) =>
    new GeminiLlm({ transport, model: 'm', temperature: 0, persona: 'P', blockedLine: 'Not that one.', errorLine: 'Glitch.', lines: { rate_limit: 'Slow down.', server: 'Rough moment.' }, now });

  it.each([
    [429, 'Slow down.'],
    [503, 'Rough moment.'],
    [401, 'Glitch.'],
  ])('status %i gets its own line', async (code, line) => {
    expect(await say(make(status(code), () => 0))).toBe(line);
  });

  it('apologises once per failure, stays silent while it keeps failing, then again after the cooldown', async () => {
    let t = 0;
    const llm = make(status(429), () => t);
    expect(await say(llm)).toBe('Slow down.');
    t = 10_000;
    expect(await say(llm)).toBe('');
    t = 31_000;
    expect(await say(llm)).toBe('Slow down.');
  });

  it('a safety block gets its own line', async () => {
    const t: Transport = async function* () {
      yield { blockReason: 'SAFETY' };
    };
    expect(await say(make(t, () => 0))).toBe('Not that one.');
  });

  it('recovery resets the gate', async () => {
    let fail = true;
    const t: Transport = async function* () {
      if (fail) throw Object.assign(new Error('x'), { status: 503 });
      yield { text: 'All good.' };
    };
    const llm = make(t, () => 0);
    expect(await say(llm)).toBe('Rough moment.');
    fail = false;
    expect(await say(llm)).toBe('All good.');
    fail = true;
    expect(await say(llm)).toBe('Rough moment.'); // fresh apology even inside the cooldown window
  });
});

const CAPTURE = { silenceEndMs: 800, minUtteranceMs: 400, maxUtteranceMs: 20_000, energyGate: 500 };
const tone = (ms: number, amp: number): Buffer => {
  const n = (48000 * ms) / 1000;
  const a = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) a[i * 2] = a[i * 2 + 1] = Math.round(amp * Math.sin((i * 2 * Math.PI * 220) / 48000));
  return Buffer.from(a.buffer);
};

describe('sidecar down', () => {
  function rig(ttsWorks: boolean) {
    let onStart: (id: string) => void = () => {};
    const streams = new Map<string, PassThrough>();
    const receiver: ReceiverLike = { onSpeakingStart: (l) => (onStart = l), subscribePcm: (id) => streams.set(id, new PassThrough()).get(id)! };
    const spoken: string[] = [];
    const logs: string[] = [];
    let t = 0;
    const tts = new FakeTts();
    const s = startSession({
      receiver,
      stt: { transcribe: async () => { throw new Error('sidecar unreachable'); } },
      llm: new FakeLlm(() => ['never reached.']),
      tts: { synthesize: async (text) => (ttsWorks ? (spoken.push(text), tts.synthesize(text)) : Promise.reject(new Error('sidecar unreachable'))) },
      player: { enqueue() {}, stop() {} },
      capture: CAPTURE,
      minSentenceChars: 8,
      hearingErrorLine: "Can't hear you.",
      now: () => t,
      resolveSpeaker: (id) => ({ userId: id, userName: id, isBot: false }),
      log: (m) => logs.push(m),
    });
    const speak = (id: string): void => {
      onStart(id);
      streams.get(id)!.write(tone(1000, 6000));
      streams.get(id)!.write(tone(900, 0));
    };
    return { s, speak, spoken, logs, advance: (ms: number) => (t += ms) };
  }

  it('says it once, not on every utterance, and never crashes', async () => {
    const r = rig(true);
    r.speak('a');
    r.speak('b');
    await r.s.whenIdle();
    expect(r.spoken).toEqual(["Can't hear you."]);
    r.advance(31_000);
    r.speak('c');
    await r.s.whenIdle();
    expect(r.spoken).toHaveLength(2);
    expect(r.logs.filter((l) => l.includes('turn failed'))).toHaveLength(3);
  });

  it('stays quiet (logs only) when the voice is down too', async () => {
    const r = rig(false);
    r.speak('a');
    await r.s.whenIdle();
    expect(r.logs.some((l) => l.includes('turn failed'))).toBe(true);
  });
});
