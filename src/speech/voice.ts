import type { AudioChunk, Tts } from '../pipeline/types.js';
import type { Settings, VoiceKind } from '../settings.js';

export interface VoiceBackend {
  synthesizeVoice(text: string, voice: VoiceKind, sample: string | null, signal?: AbortSignal): Promise<AudioChunk>;
}

export interface VoiceTtsOptions {
  backend: VoiceBackend;
  settings: () => Pick<Settings, 'voice' | 'cloneSample'>;
  /** True once the sidecar reports a usable clone engine. */
  cloneReady: () => boolean;
  log?: (msg: string) => void;
}

/**
 * Tts that follows the `/voice` setting. The clone voice falls back to the fast voice when the clone isn't ready
 * or the sidecar refuses it, so the bot never goes silent over a voice choice.
 */
export class VoiceTts implements Tts {
  constructor(private readonly o: VoiceTtsOptions) {}

  /** The voice that will actually be used right now. */
  get effectiveVoice(): VoiceKind {
    return this.o.settings().voice === 'clone' && this.o.cloneReady() ? 'clone' : 'fast';
  }

  async synthesize(sentence: string, signal?: AbortSignal): Promise<AudioChunk> {
    const { cloneSample } = this.o.settings();
    if (this.effectiveVoice === 'clone') {
      try {
        return await this.o.backend.synthesizeVoice(sentence, 'clone', cloneSample, signal);
      } catch (e) {
        if (signal?.aborted) throw e;
        this.o.log?.(`clone voice failed, using fast voice: ${(e as Error).message}`);
      }
    }
    return this.o.backend.synthesizeVoice(sentence, 'fast', null, signal);
  }
}
