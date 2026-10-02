import { Orchestrator, type TraceEvent } from './pipeline/orchestrator.js';
import { FakeLlm, FakeStt, FakeTts, REALISTIC_DELAYS, cannedReply, type FakeDelays } from './pipeline/fakes.js';
import type { AudioChunk, Llm, Player, Stt, Tts } from './pipeline/types.js';

export interface TimelineEntry {
  tMs: number;
  event: TraceEvent;
  detail?: string;
}

export interface SimulationResult {
  heard: string;
  sentences: string[];
  timeline: TimelineEntry[];
  /** Time from end of user speech to first audio queued. */
  firstWordMs: number | null;
  audio: AudioChunk[];
}

export interface SimulationOptions {
  pcm: Int16Array;
  userName?: string;
  delays?: FakeDelays;
  stt?: Stt;
  llm?: Llm;
  tts?: Tts;
  minSentenceChars?: number;
}

/** Runs one utterance through the whole pipeline with fakes (or injected engines) and records a timeline. */
export async function simulate(o: SimulationOptions): Promise<SimulationResult> {
  const d = o.delays ?? REALISTIC_DELAYS;
  const t0 = performance.now();
  const timeline: TimelineEntry[] = [];
  const audio: AudioChunk[] = [];
  const player: Player = { enqueue: (c) => audio.push(c), stop: () => audio.splice(0) };
  const orch = new Orchestrator({
    stt: o.stt ?? new FakeStt((s) => `hello buddy, that was ${s.toFixed(1)} seconds`, d.sttMs),
    llm: o.llm ?? new FakeLlm(cannedReply, d),
    tts: o.tts ?? new FakeTts(d.ttsMs),
    player,
    minSentenceChars: o.minSentenceChars ?? 12,
    trace: (event, detail) => timeline.push({ tMs: Math.round(performance.now() - t0), event, detail }),
  });
  const result = await orch.handle({ userId: 'sim', userName: o.userName ?? 'Alex', pcm: o.pcm, startedAt: 0 });
  const firstQueued = timeline.find((e) => e.event === 'audio-queued');
  return {
    heard: result?.heard ?? '',
    sentences: result?.sentences ?? [],
    timeline,
    firstWordMs: firstQueued?.tMs ?? null,
    audio,
  };
}
