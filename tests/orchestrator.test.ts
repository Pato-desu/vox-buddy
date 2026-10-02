import { describe, expect, it } from 'vitest';
import { Orchestrator } from '../src/pipeline/orchestrator.js';
import type { AudioChunk, Llm, Player, Stt, Tts } from '../src/pipeline/types.js';

const utt = { userId: '1', userName: 'Alex', pcm: new Int16Array(16000), startedAt: 0 };

describe('Orchestrator', () => {
  it('drives utterance → text → sentences → audio in order', async () => {
    const log: string[] = [];
    const stt: Stt = { transcribe: async () => 'hey buddy' };
    const llm: Llm = {
      async *stream(turn) {
        log.push(`llm:${turn.speaker}:${turn.text}`);
        yield 'Hey Alex, good to ';
        yield 'hear you. What is up';
        yield ' with you today?';
      },
    };
    // Sentence 1 synthesizes slowly, sentence 2 quickly: playback order must still hold.
    const tts: Tts = {
      synthesize: async (s) => {
        await new Promise((r) => setTimeout(r, s.startsWith('Hey') ? 30 : 1));
        return { pcm: Int16Array.of(s.length), sampleRate: 22050 };
      },
    };
    const played: AudioChunk[] = [];
    const player: Player = { enqueue: (c) => played.push(c), stop: () => {} };
    const result = await new Orchestrator({ stt, llm, tts, player, minSentenceChars: 12 }).handle(utt);
    expect(log).toEqual(['llm:Alex:hey buddy']);
    expect(result?.sentences).toEqual(['Hey Alex, good to hear you.', 'What is up with you today?']);
    expect(played.map((c) => c.pcm[0])).toEqual([27, 26]);
  });

  it('drops junk transcripts', async () => {
    const stt: Stt = { transcribe: async () => '   ' };
    const llm: Llm = { stream: () => { throw new Error('should not be called'); } };
    const o = new Orchestrator({ stt, llm, tts: { synthesize: async () => ({ pcm: new Int16Array(), sampleRate: 1 }) }, player: { enqueue() {}, stop() {} }, minSentenceChars: 12 });
    expect(await o.handle(utt)).toBeNull();
  });

  it('stops enqueuing audio once aborted', async () => {
    const ctl = new AbortController();
    const played: AudioChunk[] = [];
    const o = new Orchestrator({
      stt: { transcribe: async () => 'hello there' },
      llm: { async *stream() { yield 'First sentence is here. '; ctl.abort(); yield 'Second one never plays.'; } },
      tts: { synthesize: async () => ({ pcm: Int16Array.of(1), sampleRate: 1 }) },
      player: { enqueue: (c) => played.push(c), stop() {} },
      minSentenceChars: 12,
    });
    await o.handle(utt, ctl.signal);
    expect(played).toHaveLength(0);
  });
});
