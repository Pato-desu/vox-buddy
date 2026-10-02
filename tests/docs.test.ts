import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commandDefs } from '../src/commands.js';
import { tuning } from '../src/config.js';

const read = (f: string): string => readFileSync(f, 'utf8');
const scripts = Object.keys((JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts);

describe('docs match the code', () => {
  it('README documents every slash command', () => {
    const readme = read('README.md');
    for (const c of commandDefs) expect(readme, `/${c.name}`).toContain(`\`/${c.name}`);
  });

  it('every `npm run X` in the docs is a real script', () => {
    for (const f of ['README.md', 'SETUP.md', 'CLAUDE.md']) {
      for (const m of read(f).matchAll(/npm run ([a-z-]+)/g)) expect(scripts, `${f}: npm run ${m[1]}`).toContain(m[1]);
    }
  });

  it('every script named in the README exists, and start.ps1 is documented', () => {
    for (const s of ['check', 'demo', 'smoke', 'simulate', 'doctor', 'listen-test']) expect(read('README.md')).toContain(`npm run ${s}`);
    expect(read('README.md')).toContain('start.ps1');
    expect(read('SETUP.md')).toContain('start.ps1');
  });

  it('files the docs tell people to edit exist', () => {
    expect(read('persona.md').length).toBeGreaterThan(20);
    expect(read('.gitignore')).toContain('settings.json');
    expect(read('README.md')).toContain('src/config.ts');
    expect(tuning.botName.length).toBeGreaterThan(0);
  });

  it('the barge-in modes in the docs exist in config', () => {
    expect(['stop', 'sentence', 'never']).toContain(tuning.bargeInMode);
  });
});
