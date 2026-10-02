import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { FakeStt, FakeTts, REALISTIC_DELAYS } from '../src/pipeline/fakes.js';
import { tuning } from '../src/config.js';
import { LatencyRecorder } from '../src/pipeline/metrics.js';
import { simulate } from '../src/simulate.js';
import { MAX_REPORT_BYTES, parseMilestones, renderReport, type DevInfo } from '../src/report.js';

const info = JSON.parse(readFileSync('.autodev/devinfo.json', 'utf8')) as DevInfo;
const sim = await simulate({ pcm: new Int16Array(24000) });
const latency = new LatencyRecorder();
const talk = [
  ['Alex', 'hey buddy what are we doing tonight'],
  ['Sam', 'can you settle a debate about pineapple pizza'],
  ['Jo', 'ok but be honest with us buddy'],
] as const;
const turns: { speaker: string; said: string; reply: string; firstWordMs: number | null }[] = [];
for (const [speaker, said] of talk) {
  const r = await simulate({ pcm: new Int16Array(24000), userName: speaker, stt: new FakeStt(said, REALISTIC_DELAYS.sttMs), latency });
  turns.push({ speaker, said, reply: r.sentences.join(' '), firstWordMs: r.firstWordMs });
}
// Clone synthesis is slower than Piper; these delays are placeholders until the owner measures a real GPU.
const CLONE_TTS_MS = 700;
const fast = await simulate({ pcm: new Int16Array(24000), tts: new FakeTts(REALISTIC_DELAYS.ttsMs) });
const clone = await simulate({ pcm: new Int16Array(24000), tts: new FakeTts(CLONE_TTS_MS) });
const voices = {
  budgetMs: tuning.latencyBudgetMs.firstWord,
  rows: [
    { voice: 'fast (Piper)', firstWordMs: fast.firstWordMs, note: 'offline, always available' },
    { voice: 'clone (XTTS-v2)', firstWordMs: clone.firstWordMs, note: 'warms up on /voice clone; falls back to fast if the GPU is full' },
  ],
};
const html = renderReport(info, parseMilestones(readFileSync('TASKS.md', 'utf8')), {
  heard: sim.heard,
  sentences: sim.sentences,
  firstWordMs: sim.firstWordMs,
  budgetMs: tuning.latencyBudgetMs.firstWord,
  events: sim.timeline,
}, { turns, latency: latency.summary() }, voices);
const bytes = Buffer.byteLength(html);
if (bytes > MAX_REPORT_BYTES) throw new Error(`demo too large: ${bytes} bytes`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/demo.html', html);
console.log(`dist/demo.html written (${bytes} bytes, build ${info.build})`);
