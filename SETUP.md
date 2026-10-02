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
3. OAuth2 → URL Generator: scopes `bot` and `applications.commands`; permissions: View Channels, Connect, Speak. Open the URL and add the bot to your server.
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
For GPU speech-to-text, install the CUDA 12 runtime libraries for faster-whisper; otherwise it falls back to CPU automatically.

## 5. Check, then run
In a second terminal from the repo root:
1. `npm run doctor`: every line should say OK.
2. Optional receive-only test: join a voice channel, run `npm run listen-test`, speak; it prints "heard N seconds from <you>".
3. `npm start`, then in Discord join a voice channel and type `/join`. Talk. `/leave` ends it.

## Try it without Discord
`npm run simulate` runs the whole pipeline on a generated test sound with fake engines and writes `dist/sim/reply-*.wav`. Add `--real` to use the sidecar and Gemini.
