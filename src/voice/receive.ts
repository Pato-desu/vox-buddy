import { EndBehaviorType, type VoiceReceiver } from '@discordjs/voice';
import prism from 'prism-media';
import type { Readable } from 'node:stream';
import type { Utterance } from '../pipeline/types.js';
import { UtteranceDetector, downmix48kStereoTo16kMono, type CaptureOptions, type Speaker } from './capture.js';

/** The slice of the voice receiver we use; a fake implements it in tests. */
export interface ReceiverLike {
  onSpeakingStart(listener: (userId: string) => void): void;
  /** Returns decoded 48 kHz stereo s16le PCM for one user's current speech burst. */
  subscribePcm(userId: string): Readable;
}

export function adaptReceiver(receiver: VoiceReceiver): ReceiverLike {
  return {
    onSpeakingStart: (l) => void receiver.speaking.on('start', l),
    subscribePcm: (userId) =>
      receiver
        .subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 300 } })
        .pipe(new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 })),
  };
}

export interface ReceiveOptions {
  capture: CaptureOptions;
  resolveSpeaker: (userId: string) => Speaker | undefined;
  onUtterance: (u: Utterance) => void;
  /** Called the moment a user starts speaking (used for barge-in). */
  onSpeechStart?: (userId: string) => void;
  onError?: (e: Error) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** adaptReceiver ends a user's stream after this much silence (Discord sends no packets while quiet). */
export const STREAM_END_SILENCE_MS = 300;

/** Wires per-user audio into utterance detectors. One detector per user, kept across bursts. */
export function attachReceive(receiver: ReceiverLike, o: ReceiveOptions): void {
  const detectors = new Map<string, UtteranceDetector>();
  const active = new Set<string>();
  // Real Discord audio carries no silence frames: when a stream ends, the detector must be told how long it has
  // been quiet. Wait out the rest of silenceEndMs (a brief pause mid-sentence continues the same utterance).
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const endTimers = new Map<string, unknown>();
  const cancelEnd = (userId: string): void => {
    if (endTimers.has(userId)) clearTimer(endTimers.get(userId));
    endTimers.delete(userId);
  };
  receiver.onSpeakingStart((userId) => {
    const speaker = o.resolveSpeaker(userId);
    if (!speaker || speaker.isBot) return;
    o.onSpeechStart?.(userId);
    cancelEnd(userId);
    if (active.has(userId)) return;
    active.add(userId);
    let det = detectors.get(userId);
    if (!det) {
      det = new UtteranceDetector(speaker, o.capture, o.onUtterance);
      detectors.set(userId, det);
    }
    const d = det;
    const stream = receiver.subscribePcm(userId);
    stream.on('data', (buf: Buffer) => {
      d.push(downmix48kStereoTo16kMono(new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2))));
    });
    const done = (): void => {
      if (!active.delete(userId)) return;
      cancelEnd(userId);
      endTimers.set(
        userId,
        setTimer(() => {
          endTimers.delete(userId);
          d.end();
        }, Math.max(0, o.capture.silenceEndMs - STREAM_END_SILENCE_MS)),
      );
    };
    stream.on('end', done);
    stream.on('close', done);
    stream.on('error', (e) => {
      done();
      o.onError?.(e);
    });
  });
}

/**
 * A receiver that survives reconnects: the session keeps this object while `set()` points it at each new
 * connection's receiver and re-registers the speaking listener there.
 */
export class SwitchableReceiver implements ReceiverLike {
  private current: ReceiverLike | undefined;
  private listener: ((userId: string) => void) | undefined;

  set(next: ReceiverLike): void {
    this.current = next;
    if (this.listener) next.onSpeakingStart(this.listener);
  }

  onSpeakingStart(listener: (userId: string) => void): void {
    this.listener = listener;
    this.current?.onSpeakingStart(listener);
  }

  subscribePcm(userId: string): Readable {
    if (!this.current) throw new Error('voice receiver not connected');
    return this.current.subscribePcm(userId);
  }
}
