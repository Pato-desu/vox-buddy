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
.vb .flow{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.vb .flow span{background:#222736;border-radius:8px;padding:4px 10px;font-size:14px}
.vb .flow em{color:var(--mute);font-style:normal}
`;

export function renderReport(info: DevInfo, milestones: Milestone[]): string {
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
<section><h2>Pipeline</h2><div class="flow">${flow}</div><p class="muted" style="margin-top:10px">A friend in the call: hears everyone, answers in one or two short sentences, stops when you talk over it.</p></section>
</main></div>
`;
}
