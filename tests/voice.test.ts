import { describe, expect, it } from 'vitest';
import { VoiceTts } from '../src/speech/voice.js';
import type { VoiceKind } from '../src/settings.js';

const chunk = (rate: number) => ({ pcm: new Int16Array(10), sampleRate: rate });

function rig(voice: VoiceKind, ready: boolean, cloneFails = false) {
  const calls: string[] = [];
  const tts = new VoiceTts({
    backend: {
      synthesizeVoice: async (_t, v, sample) => {
        calls.push(`${v}:${sample}`);
        if (v === 'clone' && cloneFails) throw new Error('409');
        return chunk(v === 'clone' ? 24000 : 16000);
      },
    },
    settings: () => ({ voice, cloneSample: 'me' }),
    cloneReady: () => ready,
  });
  return { tts, calls };
}

describe('VoiceTts', () => {
  it('uses the fast voice by default', async () => {
    const r = rig('fast', true);
    expect((await r.tts.synthesize('hi there')).sampleRate).toBe(16000);
    expect(r.calls).toEqual(['fast:null']);
  });
  it('uses the clone with its sample when selected and ready', async () => {
    const r = rig('clone', true);
    expect((await r.tts.synthesize('hi there')).sampleRate).toBe(24000);
    expect(r.calls).toEqual(['clone:me']);
  });
  it('falls back to fast when the clone is not ready', async () => {
    const r = rig('clone', false);
    expect(r.tts.effectiveVoice).toBe('fast');
    await r.tts.synthesize('hi there');
    expect(r.calls).toEqual(['fast:null']);
  });
  it('falls back to fast when the clone request fails', async () => {
    const r = rig('clone', true, true);
    expect((await r.tts.synthesize('hi there')).sampleRate).toBe(16000);
    expect(r.calls).toEqual(['clone:me', 'fast:null']);
  });
});
