/** Contracts between pipeline stages. Real engines and test fakes both implement these. */
export interface Utterance {
  userId: string;
  userName: string;
  /** 16 kHz mono signed 16-bit PCM. */
  pcm: Int16Array;
  startedAt: number;
}

export interface AudioChunk {
  /** Signed 16-bit mono PCM. */
  pcm: Int16Array;
  sampleRate: number;
}

export interface Stt {
  transcribe(pcm: Int16Array, sampleRate: number): Promise<string>;
}

export interface LlmTurn {
  speaker: string;
  text: string;
}

export interface Llm {
  /** Streams reply text deltas for the turn. */
  stream(turn: LlmTurn, signal?: AbortSignal): AsyncIterable<string>;
}

export interface Tts {
  synthesize(sentence: string, signal?: AbortSignal): Promise<AudioChunk>;
}

export interface Player {
  enqueue(chunk: AudioChunk): void;
  stop(): void;
  /** Drops queued chunks but lets the one playing finish (barge-in variant B). */
  dropPending?(): void;
  /** Resolves when nothing is playing or queued (immediately if already idle). */
  whenIdle?(): Promise<void>;
  /** True while audio is coming out. */
  readonly playing?: boolean;
}
