import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { MAX_REPORT_BYTES, parseMilestones, renderReport, type DevInfo } from '../src/report.js';

const info = JSON.parse(readFileSync('.autodev/devinfo.json', 'utf8')) as DevInfo;
const html = renderReport(info, parseMilestones(readFileSync('TASKS.md', 'utf8')));
const bytes = Buffer.byteLength(html);
if (bytes > MAX_REPORT_BYTES) throw new Error(`demo too large: ${bytes} bytes`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/demo.html', html);
console.log(`dist/demo.html written (${bytes} bytes, build ${info.build})`);
