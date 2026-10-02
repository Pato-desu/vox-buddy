import type { AudioChunk, Llm, LlmTurn, Stt, Tts } from './types.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface FakeDelays {
  sttMs: number;
  llmFirstMs: number;
  llmDeltaMs: number;
  ttsMs: number;
}

/** Roughly realistic delays for the latency budget (SPEC §5). */
export const REALISTIC_DELAYS: FakeDelays = { sttMs: 450, llmFirstMs: 550, llmDeltaMs: 120, ttsMs: 250 };

export class FakeStt implements Stt {
  constructor(private readonly text: string | ((seconds: number) => string), private readonly delayMs = 0) {}
  async transcribe(pcm: Int16Array, sampleRate: number): Promise<string> {
    await sleep(this.delayMs);
    return typeof this.text === 'function' ? this.text(pcm.length / sampleRate) : this.text;
  }
}

export class FakeLlm implements Llm {
  constructor(private readonly script: (turn: LlmTurn) => string[], private readonly d: Pick<FakeDelays, 'llmFirstMs' | 'llmDeltaMs'> = { llmFirstMs: 0, llmDeltaMs: 0 }) {}
  async *stream(turn: LlmTurn): AsyncIterable<string> {
    await sleep(this.d.llmFirstMs);
    let first = true;
    for (const delta of this.script(turn)) {
      if (!first) await sleep(this.d.llmDeltaMs);
      first = false;
      yield delta;
    }
  }
}

/** Fake TTS: a short tone per word, so output wavs are audibly different per sentence. */
export class FakeTts implements Tts {
  constructor(private readonly delayMs = 0, private readonly sampleRate = 22050) {}
  async synthesize(sentence: string): Promise<AudioChunk> {
    await sleep(this.delayMs);
    const words = sentence.split(/\s+/).filter(Boolean).length;
    const n = Math.floor(this.sampleRate * 0.18 * words);
    const pcm = new Int16Array(n);
    const freq = 200 + (sentence.length % 7) * 40;
    for (let i = 0; i < n; i++) {
      const env = Math.min(1, i / 400, (n - i) / 400);
      pcm[i] = Math.round(7000 * env * Math.sin((2 * Math.PI * freq * i) / this.sampleRate));
    }
    return { pcm, sampleRate: this.sampleRate };
  }
}

/** The canned persona-ish reply the simulation uses. */
export function cannedReply(turn: LlmTurn): string[] {
  return [`Hey ${turn.speaker}, `, 'good to hear you. ', 'What are we getting into ', 'today?'];
}
