import type { Utterance } from '../pipeline/types.js';

export const TARGET_RATE = 16000;

/** 48 kHz interleaved stereo s16 → 16 kHz mono s16 (average channels, average each group of 3). */
export function downmix48kStereoTo16kMono(stereo: Int16Array): Int16Array {
  const frames = Math.floor(stereo.length / 2);
  const out = new Int16Array(Math.floor(frames / 3));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let k = 0; k < 3; k++) {
      const f = i * 3 + k;
      sum += (stereo[f * 2] ?? 0) + (stereo[f * 2 + 1] ?? 0);
    }
    out[i] = Math.round(sum / 6);
  }
  return out;
}

export function rms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let s = 0;
  for (const v of pcm) s += v * v;
  return Math.sqrt(s / pcm.length);
}

export interface CaptureOptions {
  silenceEndMs: number;
  minUtteranceMs: number;
  maxUtteranceMs: number;
  /** RMS above this counts as speech. */
  energyGate: number;
}

export interface Speaker {
  userId: string;
  userName: string;
  isBot: boolean;
}

/**
 * Per-user utterance detector over 16 kHz mono frames. Time is derived from sample counts,
 * so behaviour is deterministic: no wall clock involved.
 */
export class UtteranceDetector {
  private chunks: Int16Array[] = [];
  private speechSamples = 0;
  private trailingSilence = 0;
  private total = 0;
  private startedAt = 0;
  private clock = 0;

  constructor(private readonly speaker: Speaker, private readonly o: CaptureOptions, private readonly onUtterance: (u: Utterance) => void) {}

  get speaking(): boolean {
    return this.chunks.length > 0;
  }

  /** Feed a frame (any length; typically 20 ms). */
  push(frame: Int16Array): void {
    if (this.speaker.isBot) return;
    const ms = (n: number): number => (n / TARGET_RATE) * 1000;
    const loud = rms(frame) >= this.o.energyGate;
    if (!this.speaking) {
      if (loud) {
        this.startedAt = this.clock;
        this.chunks = [frame];
        this.total = frame.length;
        this.speechSamples = frame.length;
        this.trailingSilence = 0;
      }
    } else {
      this.chunks.push(frame);
      this.total += frame.length;
      if (loud) {
        this.speechSamples += frame.length;
        this.trailingSilence = 0;
      } else {
        this.trailingSilence += frame.length;
      }
      if (ms(this.trailingSilence) >= this.o.silenceEndMs || ms(this.total) >= this.o.maxUtteranceMs) this.finish();
    }
    this.clock += frame.length;
  }

  /** Call when the user's stream ends (left channel, disconnect). */
  end(): void {
    if (this.speaking) this.finish();
  }

  private finish(): void {
    const keepSamples = this.total - this.trailingSilence;
    const speechMs = (this.speechSamples / TARGET_RATE) * 1000;
    const pcm = new Int16Array(this.total);
    let off = 0;
    for (const c of this.chunks) {
      pcm.set(c, off);
      off += c.length;
    }
    this.chunks = [];
    this.total = 0;
    this.speechSamples = 0;
    this.trailingSilence = 0;
    if (speechMs < this.o.minUtteranceMs) return; // keyboard click, cough
    this.onUtterance({
      userId: this.speaker.userId,
      userName: this.speaker.userName,
      pcm: pcm.subarray(0, Math.max(keepSamples, 0) || pcm.length),
      startedAt: (this.startedAt / TARGET_RATE) * 1000,
    });
  }
}
