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
