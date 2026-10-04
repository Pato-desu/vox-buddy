import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { attachReceive, type ReceiverLike } from '../src/voice/receive.js';
import type { Utterance } from '../src/pipeline/types.js';

const CAPTURE = { silenceEndMs: 800, minUtteranceMs: 400, maxUtteranceMs: 20_000, energyGate: 500 };

function pcm48(ms: number, amp: number): Buffer {
  const frames = (48000 * ms) / 1000;
  const a = new Int16Array(frames * 2);
  for (let i = 0; i < frames; i++) a[i * 2] = a[i * 2 + 1] = Math.round(amp * Math.sin((i * 2 * Math.PI * 220) / 48000));
  return Buffer.from(a.buffer);
}

describe('attachReceive', () => {
  it('turns two users’ bursts into two utterances and ignores bots', () => {
    const streams = new Map<string, PassThrough>();
    let onStart: (id: string) => void = () => {};
    const receiver: ReceiverLike = {
      onSpeakingStart: (l) => (onStart = l),
      subscribePcm: (id) => {
        const s = new PassThrough();
        streams.set(id, s);
        return s;
      },
    };
    const out: Utterance[] = [];
    const starts: string[] = [];
    attachReceive(receiver, {
      capture: CAPTURE,
      resolveSpeaker: (id) => ({ userId: id, userName: id.toUpperCase(), isBot: id === 'bot' }),
      onUtterance: (u) => out.push(u),
      onSpeechStart: (id) => starts.push(id),
    });
    for (const id of ['a', 'b', 'bot']) {
      onStart(id);
      const s = streams.get(id);
      if (!s) continue;
      s.write(pcm48(1000, 6000));
      s.write(pcm48(900, 0));
    }
    expect(streams.has('bot')).toBe(false);
    expect(starts).toEqual(['a', 'b']);
    expect(out.map((u) => u.userName)).toEqual(['A', 'B']);
    expect(out[0]!.pcm.length).toBe(16000);
  });
});

describe('onSpeechConfirmed', () => {
  const setup = () => {
    const streams = new Map<string, PassThrough>();
    let onStart: (id: string) => void = () => {};
    const receiver: ReceiverLike = { onSpeakingStart: (l) => (onStart = l), subscribePcm: (id) => streams.set(id, new PassThrough()).get(id)! };
    const confirmed: string[] = [];
    attachReceive(receiver, {
      capture: CAPTURE,
      resolveSpeaker: (id) => ({ userId: id, userName: id, isBot: id === 'bot' }),
      onUtterance: () => {},
      onSpeechConfirmed: (id) => confirmed.push(id),
    });
    return { onStart, streams, confirmed };
  };

  it('fires once, only after 300 ms of loud speech, and never for bots', () => {
    const { onStart, streams, confirmed } = setup();
    onStart('a');
    streams.get('a')!.write(pcm48(100, 6000));
    expect(confirmed).toEqual([]); // a blip
    streams.get('a')!.write(pcm48(150, 6000));
    expect(confirmed).toEqual([]); // 250 ms: not yet
    streams.get('a')!.write(pcm48(100, 6000));
    expect(confirmed).toEqual(['a']); // 350 ms
    streams.get('a')!.write(pcm48(1000, 6000));
    expect(confirmed).toEqual(['a']); // once per utterance
    onStart('bot');
    expect(streams.has('bot')).toBe(false);
  });

  it('ignores audio under the energy gate', () => {
    const { onStart, streams, confirmed } = setup();
    onStart('a');
    streams.get('a')!.write(pcm48(2000, 100));
    expect(confirmed).toEqual([]);
  });
});

describe('SwitchableReceiver', () => {
  it('re-registers the listener and routes audio to the newest receiver', async () => {
    const { SwitchableReceiver } = await import('../src/voice/receive.js');
    const { PassThrough } = await import('node:stream');
    const mk = () => {
      let l: (id: string) => void = () => {};
      return { onSpeakingStart: (x: (id: string) => void) => (l = x), subscribePcm: () => new PassThrough(), fire: (id: string) => l(id) };
    };
    const a = mk();
    const b = mk();
    const sw = new SwitchableReceiver();
    const heard: string[] = [];
    sw.onSpeakingStart((id) => heard.push(id));
    sw.set(a);
    a.fire('x');
    sw.set(b); // reconnect
    b.fire('y');
    expect(heard).toEqual(['x', 'y']);
    expect(() => new SwitchableReceiver().subscribePcm('x')).toThrow('not connected');
  });
});

describe('real Discord audio: streams end without silence frames', () => {
  it('finishes the utterance shortly after the stream ends, and a pause mid-sentence stays one utterance', async () => {
    const { attachReceive, STREAM_END_SILENCE_MS } = await import('../src/voice/receive.js');
    const { PassThrough } = await import('node:stream');
    const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
    let onStart: (id: string) => void = () => {};
    const streams: InstanceType<typeof PassThrough>[] = [];
    const out: number[] = [];
    const loud = (ms: number): Buffer => {
      const n = (48000 * ms) / 1000;
      const a = new Int16Array(n * 2);
      for (let i = 0; i < n; i++) a[i * 2] = a[i * 2 + 1] = Math.round(6000 * Math.sin((i * 2 * Math.PI * 220) / 48000));
      return Buffer.from(a.buffer);
    };
    attachReceive(
      { onSpeakingStart: (l) => (onStart = l), subscribePcm: () => (streams.push(new PassThrough()), streams.at(-1)!) },
      {
        capture: { silenceEndMs: 800, minUtteranceMs: 400, maxUtteranceMs: 20_000, energyGate: 500 },
        resolveSpeaker: (id) => ({ userId: id, userName: id, isBot: false }),
        onUtterance: (u) => out.push(u.pcm.length),
        setTimer: (fn, ms) => timers.push({ fn, ms, cancelled: false }) - 1,
        clearTimer: (h) => void (timers[h as number]!.cancelled = true),
      },
    );
    const burst = async (): Promise<void> => {
      onStart('a');
      streams.at(-1)!.write(loud(600));
      streams.at(-1)!.end(); // Discord stops sending: the stream just ends
      await new Promise((r) => setImmediate(r));
    };
    onStart('a');
    streams.at(-1)!.write(loud(600));
    streams.at(-1)!.end();
    await new Promise((r) => setImmediate(r));
    expect(out).toEqual([]); // nothing yet: still within the 800 ms silence window
    expect(timers.at(-1)!.ms).toBe(800 - STREAM_END_SILENCE_MS);
    // the speaker resumes before the window closes: same utterance, timer replaced
    await burst();
    expect(timers[0]!.cancelled).toBe(true);
    expect(out).toEqual([]);
    timers.at(-1)!.fn(); // silence window elapsed
    expect(out).toHaveLength(1);
    expect(out[0]).toBeGreaterThanOrEqual(16000 * 1.1); // both bursts in one utterance
  });
});
