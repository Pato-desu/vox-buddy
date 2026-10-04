import type { BargeInMode } from '../config.js';
import { isLeaveCommand } from '../pipeline/policy.js';
import { attachReceive, type ReceiverLike } from '../voice/receive.js';
import type { CaptureOptions, Speaker } from '../voice/capture.js';
import type { Utterance } from '../pipeline/types.js';
import type { LiveConnection, LiveConnector, LiveEvents, LiveOutput } from './types.js';

export interface LiveSessionDeps {
  receiver: ReceiverLike;
  connect: LiveConnector;
  output: LiveOutput;
  capture: CaptureOptions;
  model: string;
  voice: string;
  /** The persona text, read again on every (re)connect. */
  persona: () => string;
  resolveSpeaker: (userId: string) => Speaker | undefined;
  bargeIn?: BargeInMode;
  /** The spoken command that makes the bot leave (matched on what the cloud heard). */
  leave?: { phrase: string };
  onLeave?: () => void;
  onTurn?: (speaker: string, heard: string, said: string) => void;
  log?: (msg: string) => void;
  debug?: (msg: string) => void;
  sleep?: (ms: number) => Promise<void>;
  maxReconnects?: number;
}

export interface LiveSessionHandle {
  readonly hushed: boolean;
  setHushed(on: boolean): void;
  /** Resolves when every utterance heard so far has been sent. */
  whenSent(): Promise<void>;
  /** Hangs up the cloud session and cuts any audio. */
  close(): void;
}

/** What the cloud model is told about the call, on top of the persona. */
export const LIVE_PRIMER =
  'You are hearing a Discord voice call directly, not reading a transcript. Before each person speaks you get a short note like "(Alex is speaking)". ' +
  'Use it to know who is talking and never say it out loud. Reply only when someone has said something, in the same language they used.';

const RECONNECT_BASE_MS = 500;

/**
 * One voice-channel session in live mode: per-person utterances go to a Gemini Live session and its audio comes back
 * out through `output`. Reuses the same receive, noise gate and barge-in detection as the classic pipeline.
 */
export function startLiveSession(d: LiveSessionDeps): LiveSessionHandle {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const bargeIn = d.bargeIn ?? 'stop';
  const maxReconnects = d.maxReconnects ?? 5;
  let conn: LiveConnection | null = null;
  let closed = false;
  let hushed = false;
  let resumeHandle: string | undefined;
  let modelActive = false; // the model is mid-reply
  let discard = false; // audio of a reply we already cut off locally
  let inText = '';
  let outText = '';
  let lastSpeaker = '';
  let chain: Promise<void> = Promise.resolve();
  let turnWaiters: (() => void)[] = [];
  const wake = (): void => {
    const w = turnWaiters;
    turnWaiters = [];
    w.forEach((f) => f());
  };

  const events: LiveEvents = {
    onAudio: (pcm) => {
      if (discard || hushed) return;
      modelActive = true;
      d.output.push(pcm);
    },
    onInputText: (t) => void (inText += t),
    onOutputText: (t) => void (outText += t),
    onInterrupted: () => {
      d.output.stop();
      outText = '';
      modelActive = false;
      wake();
    },
    onTurnComplete: () => {
      modelActive = false;
      discard = false;
      d.output.end();
      wake();
      const heard = inText.trim();
      const said = outText.trim();
      inText = outText = '';
      if (d.leave && heard && isLeaveCommand(heard, d.leave.phrase)) {
        d.log?.('asked to leave by voice');
        void d.output.whenIdle().then(() => d.onLeave?.());
        return;
      }
      if (heard) d.debug?.(`heard: ${heard}`);
      if (said) d.debug?.(`said: ${said}`);
      if ((heard || said) && !hushed) d.onTurn?.(lastSpeaker, heard, said);
    },
    onResumeHandle: (h) => void (resumeHandle = h),
    onGoAway: () => d.log?.('live: the server will drop the connection soon; reconnecting when it does'),
    onClose: (reason) => {
      if (closed) return;
      conn = null;
      d.log?.(`live: connection closed${reason ? ` (${reason})` : ''}`);
      void reconnect();
    },
  };

  const open = async (): Promise<void> => {
    conn = await d.connect({ model: d.model, systemInstruction: `${d.persona()}\n\n${LIVE_PRIMER}`, voice: d.voice, ...(resumeHandle && { resumeHandle }) }, events);
  };

  let reconnecting = false;
  const reconnect = async (): Promise<void> => {
    if (reconnecting) return;
    reconnecting = true;
    try {
      for (let attempt = 0; attempt < maxReconnects && !closed; attempt++) {
        await sleep(RECONNECT_BASE_MS * 2 ** attempt);
        if (closed) return;
        try {
          await open();
          d.log?.('live: reconnected');
          return;
        } catch (e) {
          d.log?.(`live: reconnect ${attempt + 1} failed: ${(e as Error).message}`);
        }
      }
      if (!closed) d.log?.('live: could not reconnect; use /join again');
    } finally {
      reconnecting = false;
    }
  };

  /** In 'never' barge-in mode the model is not allowed to be cut off, so a new utterance waits for it to finish. */
  const waitQuiet = async (): Promise<void> => {
    while (modelActive && !closed) await new Promise<void>((r) => turnWaiters.push(r));
    await d.output.whenIdle();
  };

  const send = async (u: Utterance): Promise<void> => {
    if (hushed || closed) return;
    if (bargeIn === 'never') await waitQuiet();
    const c = conn;
    if (!c) return void d.log?.('live: not connected, dropped an utterance');
    lastSpeaker = u.userName;
    discard = false;
    c.startActivity();
    c.sendText(`(${u.userName} is speaking)`);
    c.sendAudio(u.pcm);
    c.endActivity();
  };

  const onUtterance = (u: Utterance): void => {
    chain = chain.then(() => send(u)).catch((e: Error) => d.log?.(`live: send failed: ${e.message}`));
  };

  /** Someone has really been talking (not a noise blip): cut the reply locally; the server is cut when their words arrive. */
  const onInterruption = (userId: string): void => {
    if (bargeIn === 'never' || (!modelActive && !d.output.playing)) return;
    d.output.stop();
    discard = true;
    d.log?.(`barge-in: reply stopped by ${d.resolveSpeaker(userId)?.userName ?? 'someone'}`);
  };

  attachReceive(d.receiver, { onSpeechConfirmed: onInterruption, capture: d.capture, resolveSpeaker: d.resolveSpeaker, onUtterance, onError: (e) => d.log?.(`audio stream error: ${e.message}`) });
  open().then(
    () => d.log?.('live: connected'),
    (e: Error) => {
      d.log?.(`live: could not connect: ${e.message}`);
      void reconnect();
    },
  );

  return {
    get hushed() {
      return hushed;
    },
    setHushed: (on) => {
      hushed = on;
      if (on) {
        d.output.stop();
        discard = true;
      }
    },
    whenSent: () => chain,
    close: () => {
      closed = true;
      conn?.close();
      conn = null;
      d.output.stop();
      wake();
    },
  };
}
