# Setup (Windows 11, from zero)

You need: Node.js 24 LTS, Python 3.11, ffmpeg, a Discord server you control, a Google AI Studio key.

## 1. Install the tools
1. Node 24 LTS: https://nodejs.org (accept defaults).
2. Python 3.11: https://www.python.org/downloads/ (tick "Add python.exe to PATH").
3. ffmpeg: in PowerShell run `winget install ffmpeg`, then reopen the terminal.
4. Get the code and install: `git clone https://github.com/Pato-desu/vox-buddy`, `cd vox-buddy`, `git checkout claude/autodev`, `npm ci`.

## 2. Make the Discord app
1. https://discord.com/developers/applications → New Application → Bot → Reset Token → copy the token.
2. No privileged intents are needed (leave Presence, Server Members and Message Content off).
3. OAuth2 → URL Generator: scopes `bot` and `applications.commands`; permissions: View Channels, Connect, Speak (add Send Messages only if you want `/mirror`). Open the URL and add the bot to your server.
4. In Discord, enable Developer Mode (Settings → Advanced), right-click your server → Copy Server ID.

## 3. Secrets
Copy `.env.example` to `.env` and fill `DISCORD_TOKEN`, `GOOGLE_API_KEY` (https://aistudio.google.com/apikey) and `GUILD_ID`. `.env` is git-ignored: never share or commit it.

## 4. Speech sidecar (Python)
```powershell
cd services/speech
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt -r requirements-real.txt
python download_models.py
$env:SPEECH_ENGINES = "real"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```
Leave this window open. (Without `SPEECH_ENGINES=real` it runs fake engines, which is only useful for tests.)
On an NVIDIA GPU, `requirements-real.txt` also installs the CUDA 12 runtime (cuBLAS, cuDNN, about 1 GB) so speech-to-text runs on the GPU; without one it falls back to CPU automatically, about 2 s slower per utterance. The sidecar loads both models in the background at start-up, so the first reply isn't slow.

## 5. Voices
`/voice fast` (default) is Piper: quick and offline. To change it, pick another English voice from https://huggingface.co/rhasspy/piper-voices (an `.onnx` plus its `.onnx.json`), put both in `services/speech/models/`, and set `$env:PIPER_VOICE = "models/<name>.onnx"` before starting the sidecar.

`/voice clone` speaks in a voice you provide (Coqui XTTS-v2, needs an NVIDIA GPU with about 3 GB free (it uses about 2 GB; close Chrome or Brave if the bot says it is low on GPU memory); the first use downloads roughly 2 GB):
1. Record 10-20 seconds of one person talking naturally, in a quiet room, no music or other voices. Anything from 5 to 30 seconds works.
2. Save it as a 16-bit PCM `.wav` (Audacity: Export as WAV, "Signed 16-bit PCM") in the `voices/` folder at the repo root, e.g. `voices/me.wav`. Only clone voices you have the right to use.
3. In Discord: `/voices list` shows each sample and why one is unusable, `/voices use me` selects it and switches to the clone voice. `/voice fast` switches back.
4. Switching warms the model up, so the first reply may still be slow. If the GPU is too full the bot says so once and keeps talking with the fast voice; `/status` shows free GPU memory.

## 6. One-command start (after step 3, secrets)
`.\start.ps1` creates the sidecar venv, installs its requirements, downloads the Piper voice, starts the sidecar, waits until it is healthy, then runs the bot. Ctrl+C stops both. `-Fake` uses fake engines (no models) and `-Port` changes the sidecar port. If PowerShell blocks scripts, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once. Steps 4 and 5 below do the same by hand.

## 7. Check, then run
In a second terminal from the repo root:
1. `npm run doctor`: every line should say OK.
2. Optional receive-only test: join a voice channel, run `npm run listen-test`, speak; it prints "heard N seconds from <you>".
3. `npm start`, then in Discord join a voice channel and type `/join`. Talk. `/leave` ends it.

## Live mode (all-cloud, optional)
No sidecar, GPU or voice files needed. Run `/mode live` in Discord (it rejoins your channel), and Gemini Live (`liveModel` in `src/config.ts`, default `gemini-3.8-live`; `gemini-3.8-live-extended-thinking` reasons more but answers slower) hears the call and answers in its own voice (`liveVoice`, default Kore). It uses the same `GOOGLE_API_KEY`. The call's audio goes to Google, so it is off until someone asks for it; `/mode classic` switches back. `/voice`, voice cloning and `/usage` are classic-mode features.

## Try it without Discord
`npm run simulate` runs the whole pipeline on a generated test sound with fake engines and writes `dist/sim/reply-*.wav`. Add `--real` to use the sidecar and Gemini.
