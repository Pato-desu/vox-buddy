import { describe, expect, it } from 'vitest';
import { UtteranceDetector, downmix48kStereoTo16kMono, rms, type Speaker } from '../src/voice/capture.js';
import type { Utterance } from '../src/pipeline/types.js';

const OPTS = { silenceEndMs: 800, minUtteranceMs: 400, maxUtteranceMs: 20_000, energyGate: 500 };
const FRAME = 320; // 20 ms at 16 kHz

function tone(ms: number, amp = 6000): Int16Array[] {
  const frames: Int16Array[] = [];
  for (let i = 0; i < ms / 20; i++) frames.push(Int16Array.from({ length: FRAME }, (_, j) => Math.round(amp * Math.sin(((i * FRAME + j) * 2 * Math.PI * 220) / 16000))));
  return frames;
}
const silence = (ms: number): Int16Array[] => Array.from({ length: ms / 20 }, () => new Int16Array(FRAME));
const human = (id: string): Speaker => ({ userId: id, userName: id, isBot: false });

function run(speaker: Speaker, frames: Int16Array[]): Utterance[] {
  const out: Utterance[] = [];
  const d = new UtteranceDetector(speaker, OPTS, (u) => out.push(u));
  frames.forEach((f) => d.push(f));
  return out;
}

describe('UtteranceDetector', () => {
  it('emits one utterance after 0.8 s of silence, trimmed of the trailing silence', () => {
    const out = run(human('a'), [...silence(200), ...tone(1000), ...silence(900)]);
    expect(out).toHaveLength(1);
    expect(out[0]!.pcm.length).toBe(16000);
    expect(out[0]!.startedAt).toBe(200);
  });

  it('does not end on a short pause', () => {
    const out = run(human('a'), [...tone(600), ...silence(500), ...tone(600), ...silence(900)]);
    expect(out).toHaveLength(1);
    expect(out[0]!.pcm.length).toBeGreaterThan(16000);
  });

  it('ignores silence and quiet noise', () => {
    expect(run(human('a'), silence(5000))).toHaveLength(0);
    expect(run(human('a'), [...tone(2000, 100), ...silence(1000)])).toHaveLength(0);
  });

  it('drops clicks shorter than the minimum', () => {
    expect(run(human('a'), [...tone(200), ...silence(1000)])).toHaveLength(0);
  });

  it('cuts a monologue at the max length', () => {
    const out = run(human('a'), tone(25_000));
    expect(out).toHaveLength(1);
    expect(out[0]!.pcm.length).toBe(20_000 * 16);
  });

  it('ignores bots', () => {
    expect(run({ userId: 'b', userName: 'Bot', isBot: true }, [...tone(1000), ...silence(900)])).toHaveLength(0);
  });

  it('gives two speakers two utterances', () => {
    const out: Utterance[] = [];
    const a = new UtteranceDetector(human('a'), OPTS, (u) => out.push(u));
    const b = new UtteranceDetector(human('b'), OPTS, (u) => out.push(u));
    [...tone(800), ...silence(900)].forEach((f) => a.push(f));
    [...tone(1200), ...silence(900)].forEach((f) => b.push(f));
    expect(out.map((u) => u.userId)).toEqual(['a', 'b']);
  });

  it('flushes on end()', () => {
    const out: Utterance[] = [];
    const d = new UtteranceDetector(human('a'), OPTS, (u) => out.push(u));
    tone(1000).forEach((f) => d.push(f));
    d.end();
    expect(out).toHaveLength(1);
  });
});

describe('downmix', () => {
  it('converts 48k stereo to 16k mono', () => {
    const stereo = new Int16Array(48_000 * 2).fill(1000);
    const mono = downmix48kStereoTo16kMono(stereo);
    expect(mono.length).toBe(16_000);
    expect(rms(mono)).toBeCloseTo(1000, 0);
  });
});
