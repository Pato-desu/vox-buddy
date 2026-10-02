import { ConversationMemory, withMemory } from './brain/memory.js';
import { Orchestrator } from './pipeline/orchestrator.js';
import type { Llm, Player, Stt, Tts, Utterance } from './pipeline/types.js';
import { attachReceive, type ReceiverLike } from './voice/receive.js';
import type { CaptureOptions, Speaker } from './voice/capture.js';

export interface SessionDeps {
  receiver: ReceiverLike;
  stt: Stt;
  llm: Llm;
  tts: Tts;
  player: Player;
  capture: CaptureOptions;
  minSentenceChars: number;
  /** If given, replies are remembered in it (cleared by the caller on leave). */
  memory?: ConversationMemory;
  resolveSpeaker: (userId: string) => Speaker | undefined;
  /** Minimum quiet time between the end of one reply and the start of the next. */
  botTurnGapMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (msg: string) => void;
}

/**
 * One voice-channel session: receiver → utterances → pipeline → player.
 * M1 handles utterances one at a time in arrival order; M2 adds barge-in and policy on top.
 */
export function startSession(d: SessionDeps): { whenIdle: () => Promise<void> } {
  const orch = new Orchestrator({ stt: d.stt, llm: d.memory ? withMemory(d.llm, d.memory) : d.llm, tts: d.tts, player: d.player, minSentenceChars: d.minSentenceChars });
  let chain: Promise<void> = Promise.resolve();
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastReplyEnd = -Infinity;
  const onUtterance = (u: Utterance): void => {
    chain = chain
      .then(async () => {
        const wait = (d.botTurnGapMs ?? 0) - (now() - lastReplyEnd);
        if (wait > 0) await sleep(wait);
        const r = await orch.handle(u);
        if (r) lastReplyEnd = now();
        if (r) d.log?.(`turn: ${u.userName} → ${r.sentences.length} sentence(s)`);
      })
      .catch((e: Error) => d.log?.(`turn failed: ${e.message}`)); // one bad turn never kills the session
  };
  attachReceive(d.receiver, { capture: d.capture, resolveSpeaker: d.resolveSpeaker, onUtterance, onError: (e) => d.log?.(`audio stream error: ${e.message}`) });
  return { whenIdle: () => chain };
}
