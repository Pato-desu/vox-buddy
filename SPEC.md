# Vox Buddy: Spec
> v1 2026-10-02, written by Claude from the owner's brief. "(proposal)" = designed by Claude, open to change. [Dn] = DECISIONS.md.
> Tie-breaker: a friend hanging out in a Discord call (feel, pacing, brevity); Alexa/Siri-style assistants are what it must NOT feel like (no wake-word ceremony, no walls of text). An explicit decision in this spec always wins.

## 0. Original brief (verbatim)
> build a discord bot that listens and respond by talking, all in voice chat. there are some local LLMs in D:\Local AI Models and maybe some useful API keys and inspiration in a previous attempt at C:\Users\patri\Documents\Repositories\Discord-Local-LLM-VoiceChat-Bot

Owner answers (round 1): brain = Gemini only [D1] · talks = answers everything [D2] · voice = both fast voice and cloning, switchable [D3] · persona = friendly, witty buddy [D4].

Findings from the previous attempt (inputs, not instructions): it used Python `interactions.py` and died on Discord's voice encryption. It tried to hand-patch `aead_xchacha20_poly1305_rtpsize` decryption, and never got working audio receive. Discord now requires the DAVE end-to-end voice protocol, so receiving voice needs a library that implements it. Local models found: Llama 3 8B and an abliterated Llama 3 8B (Ollama format, `D:\Local AI Models`), on an RTX 3060 Ti 8 GB. The owner chose Gemini, so these are Later [D12]. Secrets in the old `.env` (Discord token, Google API key, guild id) are never copied into the repo. The owner supplies them locally (Owner to-do).

## 1. Pitch and pillars
A Discord bot that sits in a voice channel, hears everyone, and talks back out loud like a witty friend, with no typing and no wake word. Gemini does the thinking; speech recognition and voice synthesis run on the owner's PC.
Pillars:
1. **Conversation, not commands.** It just talks. (Rules out: wake words, push-to-talk, a text-first UX.)
2. **Fast to first word.** Speech starts within ~2 s of the user stopping, by speaking sentence by sentence while the rest is still being written. (Rules out: waiting for the full reply.)
3. **Short and spoken.** Replies are 1–2 sentences, natural speech, no markdown, lists or emoji. (Rules out: assistant essays.)
4. **Interruptible and polite.** If a human starts talking over it, it stops. It never talks to itself. (Rules out: echo loops, talking over people.)
5. **Yours.** Runs on your PC; swap the voice, persona and brain through plain files. (Rules out: hosted infrastructure, accounts.)

## 2. Audience, device, input, language
- One owner running it on a Windows 11 PC with an 8 GB NVIDIA GPU, for friends in a private Discord server. Users talk with their Discord client mic.
- Release 1 language: English speech in, English out (proposal) [D7]. Whisper multilingual model is used, so other languages mostly work for input, but the voice and persona are English.
- Session: a call can last hours. Memory is per voice channel and short (last ~20 turns).

## 3. Core loop
- **30 s:** user speaks → silence 0.8 s → transcribed → Gemini streams a reply → first sentence spoken ≤ 2 s later → next sentences follow without gaps.
- **5 min:** back-and-forth banter with several people; the bot knows who said what; interruptions stop it cleanly.
- **Long term:** persona and voice are tuned by the owner via files and `/voice`.

## 4. Release 1 features
F1 **Join/leave.** `/join` joins the caller's voice channel; `/leave` leaves. Optional auto-join of a configured channel on start. *Accept:* bot appears in channel; voice receive works with DAVE enabled; leaving frees resources.
F2 **Listen.** Per-user audio capture, silence-based end of utterance (0.8 s), noise gate (min 0.4 s and energy threshold), max utterance 20 s. Bots are ignored (including itself). *Accept:* two users speaking get two separate utterances; silence and keyboard noise produce none.
F3 **Understand.** Local speech-to-text (faster-whisper) via the speech sidecar. Empty or junk transcripts are dropped. *Accept:* a fixture wav gives the expected text; transcripts under 2 words are ignored unless the bot was just asked something.
F4 **Think.** Gemini streaming with the persona prompt, per-channel history, and speaker names (`Alex: ...`). *Accept:* history is bounded; reply streaming is split into sentences; markdown and emoji are stripped before TTS.
F5 **Speak.** Sentence-by-sentence TTS, queued and played in order through the voice connection. *Accept:* no gap longer than 300 ms between sentences when TTS is faster than real time.
F6 **Answers everything** [D2]. Every accepted human utterance gets a reply. Guards: ignore self and other bots; one reply in flight at a time (new utterances are batched while it speaks, or interrupt it, see F7); minimum 1.5 s between bot turns when several people talk at once. A text-channel slash command `/hush` mutes replies (the bot keeps listening) and `/hush off` resumes.
F7 **Barge-in** (proposal) [D5]. When a human starts speaking while the bot talks, playback stops within 300 ms and the queue is dropped. The interrupter's utterance is answered next.
F8 **Two voices, switchable** [D3]. `fast` (Piper, offline CPU, default) and `clone` (Coqui XTTS-v2 from a sample wav in `voices/`). `/voice fast|clone` and `/voices` (list and pick a sample). Clone model loads lazily and unloads after 10 min idle to free VRAM.
F9 **Persona** [D4]. `persona.md` is the system prompt (friendly, witty buddy, 1–2 sentences, spoken style). Hot-reloaded on `/persona reload`.
F10 **Resilience.** Gemini or sidecar errors produce a short spoken apology once (not a loop); reconnects voice automatically; the process never crashes on a bad packet.
F11 **Doctor and setup.** `npm run doctor` checks Node, ffmpeg, env vars, Discord intents, sidecar health, models and the Gemini key, and prints what to fix. `SETUP.md` walks a Windows user from zero.
F12 **Simulation.** `npm run simulate -- file.wav` runs the whole pipeline (STT → LLM → TTS) without Discord, writing reply wavs. This is how cloud runs and the owner test without a call.

## 5. Systems and starting numbers (all in `src/config.ts`; secrets in `.env`)
- Silence end 800 ms · min utterance 400 ms · max utterance 20 000 ms · energy gate (proposal; tune on real audio).
- Bot turn gap 1500 ms · history 20 turns · reply cap ~40 words (prompt-enforced, hard-truncated at 80 words).
- Barge-in stop ≤ 300 ms · clone idle unload 600 s · TTS sentence min length 12 chars to avoid choppy first chunks.
- Gemini model name and temperature are config (default a fast "flash" tier model, temperature 0.9).
- Latency budget: STT ≤ 600 ms, first LLM sentence ≤ 700 ms, first TTS audio ≤ 400 ms → first word ≤ 2 s total.

## 6. Content
- Persona (default, proposal): "You are Buddy, a quick-witted friend in a Discord voice call. Speak in 1–2 short sentences, casual, funny but kind. Never use lists, markdown, emoji or stage directions. You hear several people; names are given. If you didn't catch something, say so." Bot display name is configurable (default "Buddy").
- Spoken canned lines (config): join greeting (optional, default off), error apology, "I didn't catch that".

## 7. UX
- Slash commands: `/join`, `/leave`, `/voice`, `/voices`, `/hush`, `/persona reload`, `/status` (shows connected channel, voice, last latency numbers).
- Optional text channel mirror of transcripts (off by default) for debugging [D10].
- Accessibility basics: transcript mirror gives deaf/HoH friends a text view; all commands also work without voice.

## 8. Look and sound
- Sound: the voice is the product. Default Piper voice is a clear natural English voice (chosen at build time from the free Piper voices; owner can swap by config). Short "listening/join" earcons are optional and off by default.
- Build report page (private demo) in a clean dark style, since this has no browser UI (§10).

## 9. Saving, settings
- No database. `settings.json` (voice, hush, auto-join channel, persona path) persisted next to the bot. Conversation memory is in RAM and cleared on `/leave`.
- Privacy: audio is processed in memory and never written to disk, except in `simulate` or debug mode. Transcripts are logged only at debug level. The Gemini API receives transcript text only, never audio.

## 10. Tech
- **Bot:** TypeScript on Node 24, discord.js v14 + @discordjs/voice. This version supports the DAVE end-to-end voice protocol, which the old Python attempt could not. Voice receive uses opus decoding via prism-media / @discordjs/opus. `@google/genai` for Gemini. vitest for tests.
- **Speech sidecar:** Python 3.11 FastAPI service on localhost: `/health`, `/stt` (faster-whisper, CUDA with CPU fallback), `/tts` (Piper by default; XTTS-v2 for `clone`, lazy loaded). The bot talks to it over HTTP. Engines sit behind small interfaces so tests use fakes.
- **Why a sidecar:** best STT/TTS tooling is Python; the Discord side is best in Node. They stay decoupled.
- **Demo = build report.** Nothing here can run in a browser: it needs a Discord call, a GPU and secrets. `npm run demo` writes `dist/demo.html`, a one-page build report: build number, what's new, test results, simulated latency timeline, architecture, how to run, decisions waiting. The routine republishes it to the private demo URL every run. The owner "plays" the real bot locally.
- **Cloud verification limits:** cloud runs have no Discord, no GPU and no secrets. They verify with unit tests, fakes, recorded wav fixtures (generated in-repo) and `simulate`. Anything needing the real stack is an Owner check (never blocks). The owner runs `npm run doctor` and starts the bot locally for the real test.
- **Commands:** `npm run check` (typecheck + lint + tests + build) · `npm run demo` · `npm run smoke` (loads the report under CSP, screenshots) · `npm run simulate` · `npm run doctor`.

## 11. Edge cases
Two people talk at once (queue by arrival; each answered in order, or batched) · user leaves mid-reply · long monologue (hard cap 20 s, still transcribed) · Gemini safety block (speak a short in-persona refusal) · sidecar down (speak apology once, retry in background, `/status` shows it) · DAVE handshake failure/rejoin · bot alone in channel (stop listening, auto-leave after 5 min) · very loud/clipped audio · Discord rate limits on commands.

## 12. Risks, and what the first usable build proves
- Biggest risk: **voice receive with DAVE** actually working. M1 isolates it early with a receive-only `npm run listen-test` the owner can run in one minute (Owner check).
- Second: end-to-end latency with all engines on an 8 GB card (Whisper + Piper on CPU/GPU, XTTS only when cloning).
- M1 proves: join, hear, understand, reply by voice, using the simulated pipeline in the cloud and the real one locally.

## 13. Later (not Release 1) and Out of scope
Later: local LLM provider via Ollama (Llama 3 8B / abliterated, already on disk) [D12] · wake-word / addressed-only mode [D2 alternative] · music, soundboard, TTS in other languages · multi-server persona profiles · web dashboard · per-user memory across sessions.
Out of scope: hosting in the cloud, paid services, user accounts, recording or storing call audio.
