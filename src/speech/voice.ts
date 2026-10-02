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

/** Said once (in the fast voice) when the clone voice is refused for lack of GPU memory. */
export const LOW_VRAM_NOTICE = "My graphics card is too full for my cloned voice, so I'm using my regular one for now.";

/**
 * Tts that follows the `/voice` setting. The clone voice falls back to the fast voice when the clone isn't ready
 * or the sidecar refuses it, so the bot never goes silent over a voice choice.
 */
export class VoiceTts implements Tts {
  private announced = false;

  constructor(private readonly o: VoiceTtsOptions) {}

  /** The voice that will actually be used right now. */
  get effectiveVoice(): VoiceKind {
    return this.o.settings().voice === 'clone' && this.o.cloneReady() ? 'clone' : 'fast';
  }

  async synthesize(sentence: string, signal?: AbortSignal): Promise<AudioChunk> {
    const { cloneSample } = this.o.settings();
    if (this.effectiveVoice === 'clone') {
      try {
        const out = await this.o.backend.synthesizeVoice(sentence, 'clone', cloneSample, signal);
        this.announced = false;
        return out;
      } catch (e) {
        if (signal?.aborted) throw e;
        const message = (e as Error).message;
        this.o.log?.(`clone voice failed, using fast voice: ${message}`);
        if (message.includes('low vram') && !this.announced) {
          this.announced = true; // once per episode, not on every sentence
          return this.o.backend.synthesizeVoice(`${LOW_VRAM_NOTICE} ${sentence}`, 'fast', null, signal);
        }
      }
    }
    return this.o.backend.synthesizeVoice(sentence, 'fast', null, signal);
  }
}
