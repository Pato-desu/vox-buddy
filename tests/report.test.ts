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
