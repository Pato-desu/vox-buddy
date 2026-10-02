import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = readFileSync('start.ps1', 'utf8');

describe('start.ps1', () => {
  it('parses with PowerShell when it is installed', (ctx) => {
    const pwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$e=$null; [System.Management.Automation.Language.Parser]::ParseFile("start.ps1",[ref]$null,[ref]$e)|Out-Null; if($e){$e|Out-String;exit 1}'], { encoding: 'utf8' });
    if (pwsh.error) return ctx.skip(); // no PowerShell here (e.g. cloud runs): the structural checks below still run
    expect(pwsh.status, pwsh.stdout).toBe(0);
  });

  it('has balanced braces, parentheses and quotes', () => {
    const code = script.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n').replace(/#.*$/gm, '');
    for (const [open, close] of [['{', '}'], ['(', ')']] as const) expect(code.split(open).length, open).toBe(code.split(close).length);
    const lines = code.split('\n').filter((l) => !l.includes('"'));
    for (const l of lines) expect((l.match(/'/g) ?? []).length % 2, l).toBe(0);
  });

  it('sets up the venv, starts both processes and always stops the sidecar', () => {
    expect(script).toContain('python -m venv');
    expect(script).toContain('requirements-real.txt');
    expect(script).toContain('uvicorn');
    expect(script).toContain('npm start');
    expect(script).toMatch(/finally \{[\s\S]*Stop-Process/);
    expect(script).toContain('/health');
  });

  it('only references files that exist', () => {
    for (const f of ['.env.example', 'services/speech/requirements.txt', 'services/speech/requirements-real.txt', 'services/speech/download_models.py']) expect(existsSync(f), f).toBe(true);
  });
});
