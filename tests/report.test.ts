import { describe, expect, it } from 'vitest';
import { MAX_REPORT_BYTES, parseMilestones, renderReport } from '../src/report.js';

const tasks = `## M0 — Foundation
- [x] **M0.1 A** · 1h
  - **Done:** x
- [ ] **M0.2 B** · 1h
## M1 — First talk
- [ ] **M1.1 C** · 1h
`;

describe('report', () => {
  it('parses milestone progress', () => {
    expect(parseMilestones(tasks)).toEqual([
      { title: 'M0 · Foundation', done: 1, total: 2 },
      { title: 'M1 · First talk', done: 0, total: 1 },
    ]);
  });

  it('renders a self-contained fragment with escaped content', () => {
    const html = renderReport(
      { build: 3, date: '2026-10-02', whatsNew: ['<script>x</script>'], whatToTry: [], decisionsWaiting: [] },
      parseMilestones(tasks),
    );
    expect(html).toContain('Build 3');
    expect(html).toContain('1/3 tasks done');
    expect(html).not.toContain('<script>');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\beval\b|new Function/);
    expect(Buffer.byteLength(html)).toBeLessThan(MAX_REPORT_BYTES);
  });
});

describe('timeline', () => {
  it('renders simulated events with escaped details', () => {
    const html = renderReport(
      { build: 2, date: 'd', whatsNew: [], whatToTry: [], decisionsWaiting: [] },
      [],
      { heard: 'hi <b>', sentences: [], firstWordMs: 1380, budgetMs: 2000, events: [{ tMs: 451, event: 'heard', detail: 'x<y' }, { tMs: 1380, event: 'audio-queued' }] },
    );
    expect(html).toContain('first word at 1380 ms');
    expect(html).toContain('x&lt;y');
    expect(html).not.toContain('<b>');
    expect(html).toContain('Playing');
  });
});

import { markdownToHtml } from '../src/report.js';

describe('markdownToHtml', () => {
  it('renders headings, lists, code and escapes html', () => {
    const html = markdownToHtml('## Step <1>\n1. Run `npm ci`\n2. Next\n\n```powershell\npython -m venv .venv\n```\ntext');
    expect(html).toContain('<h3>Step &lt;1&gt;</h3>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<code>npm ci</code>');
    expect(html).toContain('<pre>python -m venv .venv</pre>');
    expect(html).toContain('<p>text</p>');
    expect(html).not.toContain('<1>');
  });

  it('puts the setup guide in the report without external requests', () => {
    const html = renderReport({ build: 1, date: 'd', whatsNew: [], whatToTry: [], decisionsWaiting: [] }, [], undefined, undefined, undefined, '## A\nsee https://x.y');
    expect(html).toContain('How to try it on your PC');
  });
});
