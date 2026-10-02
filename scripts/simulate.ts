// `npm run simulate -- [file.wav] [--real]`: runs STT → LLM → TTS without Discord, writing reply wavs to dist/sim/.
// Default uses fake engines. --real uses the sidecar (SIDECAR_URL) and Gemini (GOOGLE_API_KEY).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { simulate } from '../src/simulate.js';
import { SidecarClient, decodeWav, encodeWav } from '../src/speech/client.js';
import { FakeLlm, cannedReply } from '../src/pipeline/fakes.js';
import { GeminiLlm } from '../src/brain/llm.js';
import { createGenAiTransport } from '../src/brain/gemini.js';
import { loadEnv, tuning } from '../src/config.js';
import { defaultPersona } from '../src/persona.js';

const args = process.argv.slice(2);
const real = args.includes('--real');
const file = args.find((a) => !a.startsWith('--')) ?? 'tests/fixtures/hello.wav';

function ensureFixture(path: string): void {
  if (existsSync(path)) return;
  // Generated, not recorded: 1.5 s of a voiced-ish tone so the fake pipeline has something to chew on.
  const pcm = new Int16Array(24000);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(6000 * Math.sin((2 * Math.PI * 180 * i) / 16000) * (0.6 + 0.4 * Math.sin((2 * Math.PI * 3 * i) / 16000)));
  mkdirSync('tests/fixtures', { recursive: true });
  writeFileSync(path, encodeWav(pcm, 16000));
}

ensureFixture(file);
const { pcm, sampleRate } = decodeWav(readFileSync(file));
if (sampleRate !== 16000) throw new Error(`expected a 16 kHz wav, got ${sampleRate}`);

const sidecar = new SidecarClient({ baseUrl: process.env.SIDECAR_URL ?? 'http://127.0.0.1:8765' });
const env = real ? loadEnv() : undefined;
const result = await simulate({
  pcm,
  ...(real && env
    ? {
        stt: sidecar,
        tts: sidecar,
        llm: new GeminiLlm({
          transport: createGenAiTransport(env.googleApiKey),
          model: tuning.geminiModel,
          temperature: tuning.geminiTemperature,
          persona: defaultPersona(tuning.botName),
          blockedLine: "Ha, I'm going to skip that one.",
          errorLine: 'Sorry, my brain glitched. Say that again?',
        }),
      }
    : { llm: new FakeLlm(cannedReply, { llmFirstMs: 550, llmDeltaMs: 120 }) }),
});

mkdirSync('dist/sim', { recursive: true });
result.audio.forEach((a, i) => writeFileSync(`dist/sim/reply-${i + 1}.wav`, encodeWav(a.pcm, a.sampleRate)));
writeFileSync('dist/sim/timeline.json', JSON.stringify({ heard: result.heard, sentences: result.sentences, timeline: result.timeline, firstWordMs: result.firstWordMs }, null, 2));

console.log(`heard: "${result.heard}"`);
result.sentences.forEach((s, i) => console.log(`reply ${i + 1}: "${s}" -> dist/sim/reply-${i + 1}.wav`));
for (const e of result.timeline) console.log(`${String(e.tMs).padStart(5)} ms  ${e.event}${e.detail ? `  ${e.detail}` : ''}`);
console.log(`first word: ${result.firstWordMs} ms (budget ${tuning.latencyBudgetMs.firstWord} ms)`);
