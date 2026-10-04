import { ConversationMemory, withMemory } from './brain/memory.js';
import type { BargeInMode } from './config.js';
import { LatencyRecorder } from './pipeline/metrics.js';
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
  /** D5; default 'stop'. */
  bargeIn?: BargeInMode;
  replyWordHardCap?: number;
  /** Receives each turn's timings; its trace hook is fed by the pipeline. */
  latency?: LatencyRecorder;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Spoken (once per cooldown) when speech-to-text fails but the voice still works. */
  hearingErrorLine?: string;
  log?: (msg: string) => void;
  /** The spoken command that makes the bot say goodbye and leave (e.g. "parrot leave"). */
  leave?: { phrase: string; farewell: string };
  /** Called after the goodbye has finished playing. */
  onLeave?: () => void;
  /** Called after each finished reply (for the optional transcript mirror). */
  onTurn?: (speaker: string, heard: string, said: string) => void;
  /** Transcripts go here only; wire it to a debug-level logger. */
  debug?: (msg: string) => void;
}

/**
 * One voice-channel session: receiver → utterances → pipeline → player.
 * M1 handles utterances one at a time in arrival order; M2 adds barge-in and policy on top.
 */
const HEARING_APOLOGY_COOLDOWN_MS = 30_000;

export interface SessionHandle {
  whenIdle: () => Promise<void>;
  /** While hushed the bot keeps listening but stays quiet; hushing also cuts the current reply. */
  setHushed: (on: boolean) => void;
  readonly hushed: boolean;
}

export function startSession(d: SessionDeps): SessionHandle {
  let chain: Promise<void> = Promise.resolve();
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastReplyEnd = -Infinity;
  const bargeIn = d.bargeIn ?? 'stop';
  let current: AbortController | null = null;
  let replying = false;
  let interrupted = false;
  let hushed = false;
  let heardThisTurn = false;
  let askedAt = -Infinity; // when the bot last ended a reply with a question
  const ASK_WINDOW_MS = 30_000;
  let lastHearingApology = -Infinity;
  const orchTrace = (ev: string): void => {
    if (ev === 'heard') heardThisTurn = true;
    if (ev === 'llm-first-delta') replying = true;
  };
  const orch = new Orchestrator({ stt: d.stt, llm: d.memory ? withMemory(d.llm, d.memory) : d.llm, tts: d.tts, player: d.player, minSentenceChars: d.minSentenceChars, expectingAnswer: () => now() - askedAt < ASK_WINDOW_MS,
    trace: (ev, detail) => {
      orchTrace(ev);
      d.latency?.trace(ev);
      if (ev === 'skipped') d.log?.(`skipped an utterance (${detail ?? 'junk'}): too short or just filler, so no reply`);
      else if (ev === 'heard') d.debug?.(`heard: ${detail ?? ''}`);
      else if (ev === 'sentence') d.debug?.(`said: ${detail ?? ''}`);
    }, replyWordHardCap: d.replyWordHardCap, ...(d.leave && { leave: d.leave }) });
  const onUtterance = (u: Utterance): void => {
    chain = chain
      .then(async () => {
        if (hushed) return; // heard, but not answered
        const wait = interrupted ? 0 : (d.botTurnGapMs ?? 0) - (now() - lastReplyEnd);
        interrupted = false;
        if (wait > 0) await sleep(wait);
        const ctl = (current = new AbortController());
        replying = false;
        heardThisTurn = false;
        d.latency?.begin();
        let r;
        try {
          r = await orch.handle(u, ctl.signal);
        } catch (e) {
          if (ctl.signal.aborted) return; // cut off by barge-in or /hush: expected, not a failure
          // Hearing failed (sidecar down?): say so once in a while if the voice still works, otherwise just log.
          if (!heardThisTurn && d.hearingErrorLine && !ctl.signal.aborted && now() - lastHearingApology >= HEARING_APOLOGY_COOLDOWN_MS) {
            lastHearingApology = now();
            try {
              d.player.enqueue(await d.tts.synthesize(d.hearingErrorLine, ctl.signal));
            } catch {
              /* voice is down too: nothing to say it with */
            }
          }
          throw e;
        } finally {
          replying = false;
          if (current === ctl) current = null;
        }
        if (r?.leave) {
          d.log?.('asked to leave by voice');
          await d.player.whenIdle?.(); // let the goodbye finish first
          d.onLeave?.();
          return;
        }
        if (r && !ctl.signal.aborted) {
          await d.player.whenIdle?.(); // the gap runs from the end of the spoken reply, not from when it was queued
          lastReplyEnd = now();
          askedAt = r.sentences.at(-1)?.trimEnd().endsWith('?') ? lastReplyEnd : -Infinity;
          d.latency?.finish();
        }
        if (r && !ctl.signal.aborted) d.onTurn?.(u.userName, r.heard, r.sentences.join(' '));
        if (r) d.log?.(`turn: ${u.userName} → ${r.sentences.length} sentence(s)`);
      })
      .catch((e: Error) => d.log?.(`turn failed: ${e.message}`)); // one bad turn never kills the session
  };
  /** Someone has really been talking (not just a noise blip): cut the bot off if it is mid-reply (D5). */
  const onInterruption = (userId: string): void => {
    if (bargeIn === 'never') return;
    if (!replying && !d.player.playing) return;
    current?.abort();
    interrupted = true;
    if (bargeIn === 'stop') d.player.stop();
    else d.player.dropPending?.();
    d.log?.(`barge-in: reply stopped by ${d.resolveSpeaker(userId)?.userName ?? 'someone'}`);
  };
  attachReceive(d.receiver, { onSpeechConfirmed: onInterruption, capture: d.capture, resolveSpeaker: d.resolveSpeaker, onUtterance, onError: (e) => d.log?.(`audio stream error: ${e.message}`) });
  return {
    whenIdle: () => chain,
    setHushed: (on) => {
      hushed = on;
      if (on) {
        current?.abort();
        d.player.stop();
      }
    },
    get hushed() {
      return hushed;
    },
  };
}
