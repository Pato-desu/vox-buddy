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
}

/** Wires per-user audio into utterance detectors. One detector per user, kept across bursts. */
export function attachReceive(receiver: ReceiverLike, o: ReceiveOptions): void {
  const detectors = new Map<string, UtteranceDetector>();
  const active = new Set<string>();
  receiver.onSpeakingStart((userId) => {
    const speaker = o.resolveSpeaker(userId);
    if (!speaker || speaker.isBot) return;
    o.onSpeechStart?.(userId);
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
    const done = (): void => void active.delete(userId);
    stream.on('end', done);
    stream.on('close', done);
    stream.on('error', (e) => {
      done();
      o.onError?.(e);
    });
  });
}
