import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { FakeLlm, FakeTts } from '../src/pipeline/fakes.js';
import { startSession } from '../src/session.js';
import { formatStatus } from '../src/status.js';
import type { ReceiverLike } from '../src/voice/receive.js';

const CAPTURE = { silenceEndMs: 800, minUtteranceMs: 400, maxUtteranceMs: 20_000, energyGate: 500 };
const tone = (ms: number, amp: number): Buffer => {
  const n = (48000 * ms) / 1000;
  const a = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) a[i * 2] = a[i * 2 + 1] = Math.round(amp * Math.sin((i * 2 * Math.PI * 220) / 48000));
  return Buffer.from(a.buffer);
};

describe('hush', () => {
  it('stops replies but keeps listening, and resumes on unhush', async () => {
    let onStart: (id: string) => void = () => {};
    const streams = new Map<string, PassThrough>();
    const receiver: ReceiverLike = { onSpeakingStart: (l) => (onStart = l), subscribePcm: (id) => streams.set(id, new PassThrough()).get(id)! };
    const heard: string[] = [];
    const replies: string[] = [];
    let stops = 0;
    const s = startSession({
      receiver,
      stt: { transcribe: async () => (heard.push('x'), 'hey buddy are you there') },
      llm: new FakeLlm((t) => (replies.push(t.speaker), ['Right here, friend.'])),
      tts: new FakeTts(),
      player: { enqueue() {}, stop: () => void stops++ },
      capture: CAPTURE,
      minSentenceChars: 8,
      resolveSpeaker: (id) => ({ userId: id, userName: id, isBot: false }),
    });
    const speak = (id: string): void => {
      onStart(id);
      streams.get(id)!.write(tone(1000, 6000));
      streams.get(id)!.write(tone(900, 0));
    };
    s.setHushed(true);
    expect(stops).toBe(1);
    expect(s.hushed).toBe(true);
    speak('a');
    await s.whenIdle();
    expect(replies).toEqual([]);
    s.setHushed(false);
    speak('b');
    await s.whenIdle();
    expect(replies).toEqual(['b']);
  });
});

describe('formatStatus', () => {
  const base = { channelName: 'General', hushed: false, settings: { voice: 'fast' as const, cloneSample: null }, sidecar: { ok: true, stt: 'faster-whisper', tts: 'piper' }, latency: null };
  it('shows channel, voice, sidecar health and latency', () => {
    const stat = (n: number) => ({ count: 3, avg: n, p50: n, max: n + 100 });
    const text = formatStatus({ ...base, latency: { sttMs: stat(400), firstLlmSentenceMs: stat(500), firstTtsAudioMs: stat(200), firstWordMs: stat(1100) } });
    expect(text).toContain('Channel: General');
    expect(text).toContain('Voice: fast');
    expect(text).toContain('Speech sidecar: ok');
    expect(text).toContain('First word: avg 1100 ms');
  });
  it('flags a down sidecar, hush and missing latency', () => {
    const text = formatStatus({ ...base, hushed: true, sidecar: { ok: false } });
    expect(text).toContain('(hushed)');
    expect(text).toContain('DOWN');
    expect(text).toContain('no replies yet');
  });
});

describe('formatStatus GPU and voice fallback', () => {
  it('shows free VRAM and the voice actually used', () => {
    const text = formatStatus({
      channelName: 'General', hushed: false, settings: { voice: 'clone', cloneSample: 'me' },
      sidecar: { ok: true }, latency: null, gpu: { free_mb: 900, total_mb: 8000 }, effectiveVoice: 'fast',
    });
    expect(text).toContain('but using fast right now');
    expect(text).toContain('GPU memory: 900 MB free of 8000 MB (too low for the clone voice)');
  });
});
