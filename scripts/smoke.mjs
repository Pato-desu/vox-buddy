// `npm run smoke`: loads dist/demo.html in a shell page under a strict CSP, fails on console errors,
// CSP violations or blocked/external requests, and saves screenshots to .autodev/screens/.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const CSP = "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:";
if (!existsSync('dist/demo.html')) {
  console.error('dist/demo.html missing: run `npm run demo` first');
  process.exit(1);
}
const fragment = readFileSync('dist/demo.html', 'utf8');
const shell = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CSP}"><title>demo shell</title></head><body style="margin:0">${fragment}</body></html>`;

const exe = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && existsSync(p));
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const problems = [];
try {
  mkdirSync('.autodev/screens', { recursive: true });
  for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
    const page = await browser.newPage({ viewport });
    page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(`[${name}] console ${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => problems.push(`[${name}] page error: ${e.message}`));
    page.on('requestfailed', (r) => !r.url().startsWith('data:') && problems.push(`[${name}] request failed: ${r.url()}`));
    await page.setContent(shell);
    const h1 = await page.locator('h1').first().textContent();
    if (!h1?.includes('Vox Buddy')) problems.push(`[${name}] heading missing`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) problems.push(`[${name}] horizontal scroll`);
    await page.screenshot({ path: `.autodev/screens/${name}.png`, fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('smoke OK: screenshots in .autodev/screens/');
