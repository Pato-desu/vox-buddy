import type { RollingSummary } from './pipeline/metrics.js';

/** Build report page (the demo): a self-contained HTML fragment, no external requests. */
export interface DevInfo {
  build: number;
  date: string;
  whatsNew: string[];
  whatToTry: string[];
  decisionsWaiting: string[];
}

export interface Milestone {
  title: string;
  done: number;
  total: number;
}

export interface TimelineView {
  heard: string;
  sentences: string[];
  firstWordMs: number | null;
  budgetMs: number;
  events: { tMs: number; event: string; detail?: string | undefined }[];
}

export interface VoiceCompareView {
  rows: { voice: string; firstWordMs: number | null; note: string }[];
  budgetMs: number;
}

export interface ConversationView {
  turns: { speaker: string; said: string; reply: string; firstWordMs: number | null }[];
  latency: RollingSummary;
}

export const MAX_REPORT_BYTES = 15 * 1024 * 1024;

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Counts ticked / total tasks per "## " milestone heading in TASKS.md. */
export function parseMilestones(tasksMd: string): Milestone[] {
  const out: Milestone[] = [];
  let cur: Milestone | undefined;
  for (const line of tasksMd.split('\n')) {
    const h = /^## (M\d.*)$/.exec(line);
    if (h?.[1]) {
      cur = { title: h[1].replace(/\s+—\s+/, ' · '), done: 0, total: 0 };
      out.push(cur);
      continue;
    }
    const t = /^- \[( |x)\] \*\*/.exec(line);
    if (t && cur) {
      cur.total++;
      if (t[1] === 'x') cur.done++;
    }
  }
  return out;
}

const list = (items: string[], empty: string): string =>
  items.length === 0 ? `<p class="muted">${esc(empty)}</p>` : `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;

const LABELS: Record<string, string> = {
  heard: 'Heard (speech → text)',
  'llm-first-delta': 'Gemini starts answering',
  'llm-done': 'Gemini finished',
  sentence: 'Sentence ready',
  'audio-ready': 'Voice synthesized',
  'audio-queued': 'Playing',
};

function renderTimeline(t: TimelineView): string {
  const max = Math.max(t.budgetMs, ...t.events.map((e) => e.tMs)) * 1.05;
  const rows = t.events
    .map((e) => {
      const left = ((e.tMs / max) * 100).toFixed(1);
      const detail = e.detail ? ` <span class="muted">${esc(e.detail)}</span>` : '';
      return `<div class="tl"><div class="tlabel">${esc(LABELS[e.event] ?? e.event)}${detail}</div><div class="track"><i style="left:${left}%"></i></div><div class="tms">${e.tMs} ms</div></div>`;
    })
    .join('');
  const budget = ((t.budgetMs / max) * 100).toFixed(1);
  const verdict = t.firstWordMs === null ? 'no audio' : `first word at ${t.firstWordMs} ms (budget ${t.budgetMs} ms)`;
  return `<p class="muted">Simulated with fake engines and realistic delays. You say: "${esc(t.heard)}". ${esc(verdict)}.</p><div class="tlwrap" style="--budget:${budget}%">${rows}</div>`;
}

function renderConversation(c: ConversationView): string {
  const turns = c.turns
    .map((t) => `<div class="turn"><b>${esc(t.speaker)}</b> ${esc(t.said)}<div class="reply">Buddy: ${esc(t.reply)}${t.firstWordMs === null ? '' : ` <span class="muted">(first word ${t.firstWordMs} ms)</span>`}</div></div>`)
    .join('');
  const l = c.latency;
  const stage = (label: string, k: keyof NonNullable<RollingSummary>): string => (l ? `<tr><td>${label}</td><td>${l[k].avg} ms</td><td>${l[k].p50} ms</td><td>${l[k].max} ms</td></tr>` : '');
  const table = l
    ? `<table class="lat"><tr><th>Stage</th><th>avg</th><th>median</th><th>worst</th></tr>${stage('Hear (speech to text)', 'sttMs')}${stage('Think (first sentence)', 'firstLlmSentenceMs')}${stage('Voice (first audio)', 'firstTtsAudioMs')}${stage('First word, total', 'firstWordMs')}</table>`
    : '';
  return `<p class="muted">Three friends talk in turn; Buddy answers each one, one short reply at a time. Fake engines with realistic delays.</p>${turns}${table}`;
}

function renderVoices(v: VoiceCompareView): string {
  const rows = v.rows
    .map((r) => `<tr><td>${esc(r.voice)}</td><td>${r.firstWordMs === null ? 'n/a' : `${r.firstWordMs} ms`}</td><td>${esc(r.note)}</td></tr>`)
    .join('');
  return `<p class="muted">Same sentence, both voices, simulated delays (budget ${v.budgetMs} ms). The real clone number is an Owner check on your GPU.</p><table class="lat"><tr><th>Voice</th><th>first word</th><th>note</th></tr>${rows}</table>`;
}

const PIPELINE = ['Discord voice (DAVE)', 'Utterance capture', 'Whisper STT', 'Gemini (streaming)', 'Sentence split', 'Piper / XTTS TTS', 'Playback'];

const CSS = `
.vb{--bg:#0f1115;--card:#171a21;--ink:#e8eaf0;--mute:#9aa3b2;--acc:#7c9cff;--ok:#5fd39a;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink);padding:24px 16px;min-height:100vh;box-sizing:border-box}
.vb *{box-sizing:border-box}
.vb main{max-width:760px;margin:0 auto}
.vb h1{font-size:28px;margin:0 0 4px}
.vb h2{font-size:18px;margin:0 0 10px;color:var(--acc)}
.vb .muted{color:var(--mute);margin:0}
.vb section{background:var(--card);border-radius:12px;padding:16px 18px;margin:16px 0}
.vb ul{margin:0;padding-left:20px}
.vb li{margin:4px 0}
.vb .bar{background:#2a2f3a;border-radius:6px;height:10px;overflow:hidden;margin-top:4px}
.vb .bar>i{display:block;height:100%;background:var(--ok)}
.vb .ms{margin:10px 0}
.vb .ms b{font-weight:600}
.vb .tl{display:grid;grid-template-columns:minmax(120px,38%) 1fr 64px;gap:8px;align-items:center;margin:6px 0;font-size:14px}
.vb .track{position:relative;height:8px;background:#2a2f3a;border-radius:4px}
.vb .track i{position:absolute;top:-3px;width:14px;height:14px;border-radius:50%;background:var(--acc);transform:translateX(-7px)}
.vb .tms{text-align:right;color:var(--mute);font-variant-numeric:tabular-nums}
.vb .tlwrap{position:relative;margin-top:10px}
.vb .turn{margin:10px 0;font-size:15px}
.vb .reply{color:var(--acc);margin-left:12px}
.vb table.lat{width:100%;border-collapse:collapse;margin-top:12px;font-size:14px}
.vb .lat th,.vb .lat td{text-align:right;padding:4px 6px;border-bottom:1px solid #2a2f3a}
.vb .lat th:first-child,.vb .lat td:first-child{text-align:left}
.vb .flow{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.vb .flow span{background:#222736;border-radius:8px;padding:4px 10px;font-size:14px}
.vb .flow em{color:var(--mute);font-style:normal}
`;

export function renderReport(info: DevInfo, milestones: Milestone[], timeline?: TimelineView, conversation?: ConversationView, voices?: VoiceCompareView): string {
  const done = milestones.reduce((a, m) => a + m.done, 0);
  const total = milestones.reduce((a, m) => a + m.total, 0);
  const ms = milestones
    .map((m) => {
      const pct = m.total === 0 ? 0 : Math.round((m.done / m.total) * 100);
      return `<div class="ms"><b>${esc(m.title)}</b> <span class="muted">${m.done}/${m.total}</span><div class="bar"><i style="width:${pct}%"></i></div></div>`;
    })
    .join('');
  const flow = PIPELINE.map((p) => `<span>${esc(p)}</span>`).join('<em>→</em>');
  return `<style>${CSS}</style>
<div class="vb"><main>
<header><h1>Vox Buddy</h1><p class="muted">Build ${info.build} · ${esc(info.date)} · ${done}/${total} tasks done</p></header>
<section><h2>What's new</h2>${list(info.whatsNew, 'Nothing yet.')}</section>
<section><h2>What to try</h2>${list(info.whatToTry, 'Nothing to try yet.')}</section>
<section><h2>Decisions waiting</h2>${list(info.decisionsWaiting, 'Nothing is waiting on you.')}</section>
<section><h2>Plan</h2>${ms}</section>
${timeline ? `<section><h2>Hear → think → speak (simulated)</h2>${renderTimeline(timeline)}</section>` : ''}
${conversation ? `<section><h2>Group chat (simulated)</h2>${renderConversation(conversation)}</section>` : ''}
${voices ? `<section><h2>Two voices (simulated)</h2>${renderVoices(voices)}</section>` : ''}
<section><h2>Pipeline</h2><div class="flow">${flow}</div><p class="muted" style="margin-top:10px">A friend in the call: hears everyone, answers in one or two short sentences, stops when you talk over it.</p></section>
</main></div>
`;
}
