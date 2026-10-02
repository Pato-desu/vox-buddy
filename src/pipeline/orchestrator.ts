import type { Llm, Player, Stt, Tts, Utterance } from './types.js';
import { isJunkTranscript } from './policy.js';
import { ReplyLimiter } from './length.js';
import { SentenceSplitter } from './sentences.js';

export interface OrchestratorDeps {
  stt: Stt;
  llm: Llm;
  tts: Tts;
  player: Player;
  minSentenceChars: number;
  /** Hard cap on reply length in words (default: none). */
  replyWordHardCap?: number;
  /** Optional timeline hook: called with an event name and the sentence index where relevant. */
  trace?: (event: TraceEvent, detail?: string) => void;
}

export type TraceEvent = 'heard' | 'llm-first-delta' | 'llm-done' | 'sentence' | 'audio-ready' | 'audio-queued';

export interface TurnResult {
  heard: string;
  sentences: string[];
}

/** Drives one turn: utterance → text → streamed sentences → audio chunks, in order. */
export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async handle(utt: Utterance, signal?: AbortSignal): Promise<TurnResult | null> {
    const { stt, llm, tts, player } = this.deps;
    const deps = this.deps;
    const heard = (await stt.transcribe(utt.pcm, 16000)).trim();
    deps.trace?.('heard', heard);
    if (isJunkTranscript(heard)) return null;

    const splitter = new SentenceSplitter(this.deps.minSentenceChars);
    const sentences: string[] = [];
    const limiter = new ReplyLimiter(deps.replyWordHardCap ?? Infinity);
    // TTS is started as soon as a sentence completes; playback order is preserved by awaiting in sequence.
    let tail: Promise<void> = Promise.resolve();
    const speak = (raw: string): void => {
      const sentence = limiter.take(raw);
      if (sentence === null) return;
      sentences.push(sentence);
      deps.trace?.('sentence', sentence);
      const audio = tts.synthesize(sentence, signal).then((c) => (deps.trace?.('audio-ready', sentence), c));
      audio.catch(() => {}); // if an earlier sentence failed, nobody awaits this one
      tail = tail.then(async () => {
        const chunk = await audio;
        if (!signal?.aborted) {
          player.enqueue(chunk);
          deps.trace?.('audio-queued', sentence);
        }
      });
      tail.catch(() => {}); // `await tail` below rethrows; this keeps a mid-stream failure from being reported as unhandled
    };

    let first = true;
    try {
      for await (const delta of llm.stream({ speaker: utt.userName, text: heard }, signal)) {
        if (first) {
          first = false;
          deps.trace?.('llm-first-delta');
        }
        if (signal?.aborted || limiter.capped) break;
        splitter.push(delta).forEach(speak);
      }
      deps.trace?.('llm-done');
      if (!signal?.aborted) splitter.flush().forEach(speak);
      await tail;
    } catch (e) {
      tail.catch(() => {}); // the turn is failing with `e` already
      throw e;
    }
    return { heard, sentences };
  }
}
