import type { TraceEvent } from './orchestrator.js';

export interface TurnMetrics {
  /** Speech end → transcript. */
  sttMs: number;
  /** Transcript → first full sentence from the LLM. */
  firstLlmSentenceMs: number;
  /** First sentence → first synthesized audio. */
  firstTtsAudioMs: number;
  /** Speech end → first audio handed to the player. */
  firstWordMs: number;
}

export interface Stat {
  count: number;
  avg: number;
  p50: number;
  max: number;
}

export type MetricKey = keyof TurnMetrics;
export type RollingSummary = Record<MetricKey, Stat> | null;

/** Records per-turn timings from orchestrator trace events and keeps a rolling window. */
export class LatencyRecorder {
  private turns: TurnMetrics[] = [];
  private t0 = 0;
  private marks: Partial<Record<'heard' | 'sentence' | 'audio-ready' | 'audio-queued', number>> = {};

  constructor(private readonly now: () => number = () => performance.now(), private readonly window = 20) {}

  /** Call when the utterance has ended and the pipeline starts. */
  begin(): void {
    this.t0 = this.now();
    this.marks = {};
  }

  trace = (event: TraceEvent | string): void => {
    if (event !== 'heard' && event !== 'sentence' && event !== 'audio-ready' && event !== 'audio-queued') return;
    this.marks[event] ??= this.now(); // only the first of each counts
  };

  /** Call when the turn produced a reply; ignored if the turn never reached audio. */
  finish(): TurnMetrics | null {
    const m = this.marks;
    if (m.heard === undefined || m.sentence === undefined || m['audio-ready'] === undefined || m['audio-queued'] === undefined) return null;
    const turn: TurnMetrics = {
      sttMs: Math.round(m.heard - this.t0),
      firstLlmSentenceMs: Math.round(m.sentence - m.heard),
      firstTtsAudioMs: Math.round(m['audio-ready'] - m.sentence),
      firstWordMs: Math.round(m['audio-queued'] - this.t0),
    };
    this.turns.push(turn);
    if (this.turns.length > this.window) this.turns.shift();
    return turn;
  }

  last(): TurnMetrics | null {
    return this.turns.at(-1) ?? null;
  }

  summary(): RollingSummary {
    if (this.turns.length === 0) return null;
    const keys: MetricKey[] = ['sttMs', 'firstLlmSentenceMs', 'firstTtsAudioMs', 'firstWordMs'];
    const out = {} as Record<MetricKey, Stat>;
    for (const k of keys) {
      const v = this.turns.map((t) => t[k]).sort((a, b) => a - b);
      out[k] = {
        count: v.length,
        avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
        p50: v[Math.floor((v.length - 1) / 2)]!,
        max: v.at(-1)!,
      };
    }
    return out;
  }
}
