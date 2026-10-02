import type { Llm, Player, Stt, Tts, Utterance } from './types.js';
import { SentenceSplitter } from './sentences.js';

export interface OrchestratorDeps {
  stt: Stt;
  llm: Llm;
  tts: Tts;
  player: Player;
  minSentenceChars: number;
  /** Utterances with fewer words than this are dropped. */
  minWords?: number;
}

export interface TurnResult {
  heard: string;
  sentences: string[];
}

/** Drives one turn: utterance → text → streamed sentences → audio chunks, in order. */
export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async handle(utt: Utterance, signal?: AbortSignal): Promise<TurnResult | null> {
    const { stt, llm, tts, player } = this.deps;
    const heard = (await stt.transcribe(utt.pcm, 16000)).trim();
    if (heard.split(/\s+/).filter(Boolean).length < (this.deps.minWords ?? 1)) return null;

    const splitter = new SentenceSplitter(this.deps.minSentenceChars);
    const sentences: string[] = [];
    // TTS is started as soon as a sentence completes; playback order is preserved by awaiting in sequence.
    let tail: Promise<void> = Promise.resolve();
    const speak = (sentence: string): void => {
      sentences.push(sentence);
      const audio = tts.synthesize(sentence, signal);
      tail = tail.then(async () => {
        const chunk = await audio;
        if (!signal?.aborted) player.enqueue(chunk);
      });
    };

    for await (const delta of llm.stream({ speaker: utt.userName, text: heard }, signal)) {
      if (signal?.aborted) break;
      splitter.push(delta).forEach(speak);
    }
    if (!signal?.aborted) splitter.flush().forEach(speak);
    await tail;
    return { heard, sentences };
  }
}
