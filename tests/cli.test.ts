import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commandDefs } from '../src/commands.js';

describe('commands', () => {
  it('registers the slash commands', () => {
    expect(commandDefs.map((c) => c.name)).toEqual(['join', 'leave', 'persona', 'hush', 'status', 'usage', 'voice', 'voices', 'mirror', 'autojoin']);
  });
});

describe('npm run simulate', () => {
  it('writes reply wavs from the generated fixture with fake engines', () => {
    // Run tsx through the current node binary: `npx` is npx.cmd on Windows and spawnSync can't start it without a shell.
    const r = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/simulate.ts'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('first word:');
    expect(existsSync('dist/sim/reply-1.wav')).toBe(true);
    expect(existsSync('dist/sim/timeline.json')).toBe(true);
  }, 30_000);
});
