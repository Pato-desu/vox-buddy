import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const SAMPLE_MIN_S = 5;
export const SAMPLE_MAX_S = 30;

export interface VoiceSample {
  /** File name without ".wav"; this is what `/voices use` takes. */
  name: string;
  durationS: number;
  ok: boolean;
  /** Why the file can't be used, when `ok` is false. */
  problem?: string;
}

/** Reads the wav header only: PCM format, channels, rate, bits and data length. */
export function inspectWav(buf: Buffer): { durationS: number } | { error: string } {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return { error: 'not a wav file' };
  let pos = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ' && pos + 24 <= buf.length) {
      fmt = { format: buf.readUInt16LE(pos + 8), channels: buf.readUInt16LE(pos + 10), rate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
    } else if (id === 'data') {
      if (!fmt) return { error: 'wav has no fmt chunk' };
      if (fmt.format !== 1 || fmt.bits !== 16) return { error: 'needs 16-bit PCM wav' };
      const bytes = Math.min(size, buf.length - pos - 8);
      return { durationS: bytes / (fmt.rate * fmt.channels * 2) };
    }
    pos += 8 + size + (size % 2);
  }
  return { error: 'wav has no audio data' };
}

export interface VoicesIo {
  list: (dir: string) => string[];
  read: (path: string) => Buffer;
}
const fsIo: VoicesIo = { list: (d) => readdirSync(d), read: (p) => readFileSync(p) };

/** Scans voices/*.wav and checks length (5-30 s) and format. A missing folder is just an empty list. */
export function scanVoices(dir = 'voices', io: VoicesIo = fsIo): VoiceSample[] {
  let files: string[];
  try {
    files = io.list(dir);
  } catch {
    return [];
  }
  return files
    .filter((f) => f.toLowerCase().endsWith('.wav'))
    .sort()
    .map((f): VoiceSample => {
      const name = f.slice(0, -4);
      let info: ReturnType<typeof inspectWav>;
      try {
        info = inspectWav(io.read(join(dir, f)));
      } catch {
        return { name, durationS: 0, ok: false, problem: 'unreadable' };
      }
      if ('error' in info) return { name, durationS: 0, ok: false, problem: info.error };
      const durationS = Math.round(info.durationS * 10) / 10;
      if (durationS < SAMPLE_MIN_S) return { name, durationS, ok: false, problem: `too short (${durationS} s, need ${SAMPLE_MIN_S}-${SAMPLE_MAX_S})` };
      if (durationS > SAMPLE_MAX_S) return { name, durationS, ok: false, problem: `too long (${durationS} s, need ${SAMPLE_MIN_S}-${SAMPLE_MAX_S})` };
      return { name, durationS, ok: true };
    });
}

export function formatVoices(samples: VoiceSample[], selected: string | null): string {
  if (samples.length === 0) return `No samples yet. Put a ${SAMPLE_MIN_S}-${SAMPLE_MAX_S} s clean 16-bit wav of one voice in the voices/ folder.`;
  return samples.map((s) => `${s.name === selected ? '▶ ' : '• '}${s.name}: ${s.ok ? `${s.durationS} s` : `unusable, ${s.problem}`}`).join('\n');
}
