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
  resolveSpeaker: (userId: string) => Speaker | undefined;
  log?: (msg: string) => void;
}

/**
 * One voice-channel session: receiver → utterances → pipeline → player.
 * M1 handles utterances one at a time in arrival order; M2 adds barge-in and policy on top.
 */
export function startSession(d: SessionDeps): { whenIdle: () => Promise<void> } {
  const orch = new Orchestrator({ stt: d.stt, llm: d.llm, tts: d.tts, player: d.player, minSentenceChars: d.minSentenceChars });
  let chain: Promise<void> = Promise.resolve();
  const onUtterance = (u: Utterance): void => {
    chain = chain
      .then(async () => {
        const r = await orch.handle(u);
        if (r) d.log?.(`turn: ${u.userName} → ${r.sentences.length} sentence(s)`);
      })
      .catch((e: Error) => d.log?.(`turn failed: ${e.message}`)); // one bad turn never kills the session
  };
  attachReceive(d.receiver, { capture: d.capture, resolveSpeaker: d.resolveSpeaker, onUtterance, onError: (e) => d.log?.(`audio stream error: ${e.message}`) });
  return { whenIdle: () => chain };
}
