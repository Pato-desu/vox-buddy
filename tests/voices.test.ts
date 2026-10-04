import { describe, expect, it } from 'vitest';
import { formatVoices, inspectWav, scanVoices, type VoicesIo } from '../src/voices.js';

function wav(seconds: number, opts: { rate?: number; channels?: number; bits?: number; format?: number } = {}): Buffer {
  const { rate = 16000, channels = 1, bits = 16, format = 1 } = opts;
  const dataLen = Math.round(seconds * rate * channels * (bits / 8));
  const b = Buffer.alloc(44 + dataLen);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + dataLen, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(format, 20);
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * channels * (bits / 8), 28);
  b.writeUInt16LE(channels * (bits / 8), 32);
  b.writeUInt16LE(bits, 34);
  b.write('data', 36);
  b.writeUInt32LE(dataLen, 40);
  return b;
}

const io = (files: Record<string, Buffer>): VoicesIo => ({ list: () => Object.keys(files), read: (p) => files[p.split(/[\\/]/).pop()!]! });

describe('inspectWav', () => {
  it('measures duration across rates and channels', () => {
    expect(inspectWav(wav(10))).toEqual({ durationS: 10 });
    expect(inspectWav(wav(8, { rate: 44100, channels: 2 }))).toEqual({ durationS: 8 });
  });
  it('rejects non-wav and non-16-bit PCM', () => {
    expect(inspectWav(Buffer.from('hello world'.repeat(10)))).toHaveProperty('error');
    expect(inspectWav(wav(6, { bits: 8 }))).toHaveProperty('error');
    expect(inspectWav(wav(6, { format: 3 }))).toHaveProperty('error');
  });
});

describe('scanVoices', () => {
  it('validates length and format and ignores other files', () => {
    const r = scanVoices('voices', io({ 'b.wav': wav(12), 'a.wav': wav(2), 'c.wav': wav(40), 'notes.txt': Buffer.from('x'), 'd.wav': Buffer.from('junk') }));
    expect(r.map((s) => [s.name, s.ok])).toEqual([
      ['a', false],
      ['b', true],
      ['c', false],
      ['d', false],
    ]);
    expect(r[0]!.problem).toContain('too short');
    expect(r[2]!.problem).toContain('too long');
  });
  it('returns an empty list when the folder is missing', () => {
    expect(scanVoices('nope', { list: () => { throw new Error('ENOENT'); }, read: () => Buffer.alloc(0) })).toEqual([]);
  });
});

describe('formatVoices', () => {
  it('marks the selected one and explains unusable ones', () => {
    const text = formatVoices([{ name: 'me', durationS: 12, ok: true }, { name: 'x', durationS: 2, ok: false, problem: 'too short' }], 'me');
    expect(text).toBe('▶ me: 12 s\n• x: unusable, too short');
  });
  it('explains where to put samples when there are none', () => {
    expect(formatVoices([], null)).toContain('voices/');
  });
});
