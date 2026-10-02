// `npm run doctor`: checks the local setup and prints what to fix.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadEnv, EnvError } from '../src/config.js';
import { SidecarClient } from '../src/speech/client.js';

try {
  process.loadEnvFile('.env');
} catch {
  /* .env is optional here; the env check below reports it */
}

type Row = { name: string; ok: boolean; hint: string };
const rows: Row[] = [];
const add = (name: string, ok: boolean, hint = ''): void => void rows.push({ name, ok, hint });

const major = Number(process.versions.node.split('.')[0]);
add('Node >= 22', major >= 22, `found ${process.versions.node}; install Node 24 LTS`);

const ff = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
add('ffmpeg on PATH', ff.status === 0, 'install ffmpeg (winget install ffmpeg) and reopen the terminal');

add('.env file', existsSync('.env'), 'copy .env.example to .env and fill it in');
try {
  loadEnv();
  add('env vars (DISCORD_TOKEN, GOOGLE_API_KEY, GUILD_ID)', true);
} catch (e) {
  add('env vars', false, e instanceof EnvError ? `missing: ${e.missing.join(', ')}` : String(e));
}

const health = await new SidecarClient({ baseUrl: process.env.SIDECAR_URL ?? 'http://127.0.0.1:8765', timeoutMs: 2000 }).health();
add('speech sidecar reachable', health.ok, 'start it: see SETUP.md step 4');
if (health.ok) add('sidecar engines are real (not fake)', health.stt !== 'fake', 'start the sidecar with SPEECH_ENGINES=real');

const key = process.env.GOOGLE_API_KEY;
if (key) {
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(5000) });
    add('Gemini key accepted', res.ok, `Google answered ${res.status}; create a new key in Google AI Studio`);
  } catch {
    add('Gemini key accepted', false, 'could not reach Google (network?)');
  }
}

for (const r of rows) console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.ok || !r.hint ? '' : `  ->  ${r.hint}`}`);
console.log('\nDiscord intents: in the Developer Portal enable nothing privileged; the bot needs Guilds and GuildVoiceStates only.');
process.exit(rows.every((r) => r.ok) ? 0 : 1);
