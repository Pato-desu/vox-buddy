// `npm run check`: typecheck, lint, vitest, sidecar pytest, build. Exits non-zero on any failure.
import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (label, cmd, args, opts = {}) => {
  console.log(`\n== ${label} ==`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) {
    console.error(`\ncheck FAILED at: ${label}`);
    process.exit(r.status ?? 1);
  }
};

run('typecheck', npm, ['run', '--silent', 'typecheck']);
run('lint', npm, ['run', '--silent', 'lint']);
run('tests', npm, ['run', '--silent', 'test']);

const py = ['python3', 'python', 'py'].find(
  (c) => spawnSync(c, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0,
);
if (!py) {
  console.log('\n== sidecar pytest ==\nSKIPPED: Python not found on PATH (install Python 3.11 to run sidecar tests).');
} else {
  const have = spawnSync(py, ['-c', 'import pytest'], { stdio: 'ignore' }).status === 0;
  if (!have) {
    console.log(`\n== sidecar pytest ==\nSKIPPED: pytest missing for ${py} (pip install -r services/speech/requirements.txt).`);
  } else {
    run('sidecar pytest', py, ['-m', 'pytest', '-q', 'services/speech']);
  }
}

run('build', npm, ['run', '--silent', 'build']);
console.log('\ncheck OK');
