import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commandDefs } from '../src/commands.js';

describe('commands', () => {
  it('registers the slash commands', () => {
    expect(commandDefs.map((c) => c.name)).toEqual(['join', 'leave', 'persona']);
  });
});

describe('npm run simulate', () => {
  it('writes reply wavs from the generated fixture with fake engines', () => {
    const r = spawnSync('npx', ['tsx', 'scripts/simulate.ts'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('first word:');
    expect(existsSync('dist/sim/reply-1.wav')).toBe(true);
    expect(existsSync('dist/sim/timeline.json')).toBe(true);
  }, 30_000);
});
