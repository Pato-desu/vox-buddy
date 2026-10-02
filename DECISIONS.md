# Vox Buddy: Decisions
Score = Impact × Uncertainty × Lock-in (each 1–3). 12+ ask the owner · 6–11 owner review (default applied) · 1–5 decided.
To change a decision, write "D3: B" (or anything) in FEEDBACK.md, or tell a Claude session in this repo.

## Waiting for you
(Nothing blocks. These have defaults applied; answer only if you disagree.)

### D5 · Barge-in · 8 (I2 U2 L2) · review · default A locked by M2.5 (config switch `bargeInMode`)
When a person starts talking over the bot, should it stop?
- A) Stop immediately and drop the rest, default because a friend would stop
- B) Finish the current sentence, then stop
- C) Never interrupt itself

### D7 · Language · 8 (I2 U2 L2) · review
- A) English speech and persona, default
- B) Another language (tell us which; needs a different Piper/XTTS voice and persona)

### D10 · Transcript mirror · 6 (I2 U1 L3) · review
- A) Off by default, switchable with a config flag, default because chat noise
- B) On, posts what it heard and said in a text channel

### D12 · Local LLM · 6 (I3 U1 L2) · review
Gemini is the only brain in Release 1 [D1]. The code keeps the brain behind an interface so Llama 3 8B via Ollama can be added later.
- A) Later, default
- B) Move it into Release 1 as a fallback when Gemini fails

## Decided
### D1 · Brain · 27 · owner · Gemini only (local models are not used in Release 1)
### D2 · When it talks · 27 · owner · Answers everything (guards against self-talk and pile-ups, see SPEC F6)
### D3 · Voice · 18 · owner · Both: fast offline voice and voice cloning, switchable
### D4 · Persona · 12 · owner · Friendly, witty buddy
### D6 · Several speakers · 4 · Claude · One reply at a time; speaker names in the prompt; arrivals queued
### D8 · Where it joins · 4 · Claude · `/join` plus optional configured auto-join channel
### D9 · Where it runs · 3 · Claude · Owner's Windows PC (cloning needs the GPU); not hosted
### D11 · Secrets · 3 · Claude · Local `.env` only (DISCORD_TOKEN, GOOGLE_API_KEY, GUILD_ID); never committed. The old attempt's exposed credentials should be rotated by the owner.

## Technical choices (Claude's, for the record)
- **discord.js v14 + @discordjs/voice (TypeScript, Node 24)**, because it supports Discord's mandatory DAVE voice encryption. The old Python approach failed on exactly this, and hand-patching decryption is a dead end.
- **Python FastAPI speech sidecar** (faster-whisper, Piper, Coqui XTTS-v2), because the best local speech tooling is Python; engines are behind interfaces so tests use fakes.
- **Gemini via @google/genai with streaming**, sentence-split for low-latency TTS.
- **vitest + eslint + tsc** as the single `npm run check`; **pytest** for the sidecar, included in the check.
- **No database**; JSON settings file.
- **Playwright (headless Chromium)** only for the build-report smoke test.
