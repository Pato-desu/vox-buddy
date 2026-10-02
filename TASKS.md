# Vox Buddy: Tasks
> From SPEC.md v1. Tasks take 2 h or less. Each milestone ends with a Checkpoint the owner can try in the demo (the build report) or locally.
> Done kinds: Test (automated) · Browser (headless check of the report page) · Owner (optional, never blocks; needs Discord, GPU or secrets).
> ⚠️Dn = depends on an open decision (DECISIONS.md).

| Milestone | Tasks | Hours |
|---|---|---|
| M0 Foundation | 6 | 8 |
| M1 First talk | 10 | 18 |
| M2 Conversation feel | 9 | 15 |
| M3 Two voices | 6 | 10 |
| M4 Robustness | 6 | 9 |
| M5 Release candidate | 5 | 7 |

## M0 — Foundation
- [x] **M0.1 Scaffold** · 1.5h
  - **Done:** Test: `npm ci && npm run typecheck` passes on a TypeScript (strict, ESM, Node 24) project with vitest, eslint, `src/`, `tests/`, `services/speech/`.
- [x] **M0.2 Config and logging** · 1h
  - **Done:** Test: `src/config.ts` holds every number from SPEC §5 with types; env loader (`DISCORD_TOKEN`, `GOOGLE_API_KEY`, `GUILD_ID`) validates and never prints secrets; `.env.example` exists; unit tests.
- [x] **M0.3 Check command** · 1h
  - **Done:** Test: `npm run check` runs typecheck, lint, vitest and the sidecar's pytest (skipped with a clear message if Python is absent), then builds; exits non-zero on any failure.
- [x] **M0.4 Build report generator** · 2h
  - **Done:** Test: `npm run demo` writes `dist/demo.html`, a single self-contained page fragment (≤ 15 MB, no external requests except Google Fonts, no eval) showing build number, what's new, what to try, decisions waiting, from `.autodev/devinfo.json`.
- [x] **M0.5 Smoke test** · 1.5h
  - **Done:** Browser: `npm run smoke` loads `dist/demo.html` in headless Chromium inside a strict-CSP shell page, fails on console errors, saves a screenshot to `.autodev/screens/`.
- [x] **M0.6 Publish Build 1** · 1h
  - **Done:** Owner-visible: the private demo URL shows Build 1; `AUTODEV.md` updated.
**Checkpoint M0:** the demo page shows Build 1 with its build info and the plan.

## M1 — First talk
- [x] **M1.1 Pipeline contracts + orchestrator** · 2h
  - **Done:** Test: interfaces `Stt`, `Llm`, `Tts`, `Player` and an orchestrator that takes an utterance and drives them using fakes; unit test shows utterance → text → streamed sentences → audio chunks in order.
- [x] **M1.2 Gemini client** · 2h
  - **Done:** Test: `@google/genai` streaming wrapper with persona + history; with an injected fake transport it yields text deltas; handles safety blocks and errors with typed results.
- [x] **M1.3 Sentence splitter + text cleaner** · 1.5h
  - **Done:** Test: streamed deltas become speakable sentences (min 12 chars, handles "Mr.", numbers, ellipses); markdown, emoji, asterisk actions and URLs are stripped; table-driven tests.
- [x] **M1.4 Speech sidecar skeleton** · 2h
  - **Done:** Test: pytest — FastAPI app with `/health`, `/stt`, `/tts` over engine interfaces; fake engines return deterministic audio/text; wav encode/decode utilities tested.
- [x] **M1.5 Real engines in the sidecar** · 2h
  - **Done:** Test: faster-whisper STT adapter (CUDA→CPU fallback) and Piper TTS adapter implemented behind the interface, with model download script and lazy loading; unit-tested with mocks; real-model run is an Owner check.
- [x] **M1.6 Sidecar client in the bot** · 1.5h
  - **Done:** Test: typed HTTP client (timeouts, retries, health) against a local fake server in vitest.
- [x] **M1.7 Voice join + DAVE receive** · 2h
  - **Done:** Test: `src/voice/connection.ts` wraps @discordjs/voice with DAVE enabled; join/leave/reconnect logic unit-tested against a fake adapter. Owner: `npm run listen-test` prints "heard N seconds from <user>" in a real call.
- [x] **M1.8 Utterance capture** · 2h
  - **Done:** Test: per-user opus stream → 48 kHz → 16 kHz mono PCM with silence end, noise gate and max length; ignores bots; two speakers yield two utterances; tested on generated PCM fixtures.
- [ ] **M1.9 Playback queue** · 1.5h
  - **Done:** Test: audio-chunk queue plays in order via an `AudioPlayer` abstraction, supports `stop()`, reports start/end events; tested with fakes.
- [ ] **M1.10 Wire up, slash commands, simulate, doctor, SETUP.md** · 2h
  - **Done:** Test: `/join`, `/leave` registered; `npm run simulate -- tests/fixtures/hello.wav` (generated fixture, fake engines by default) produces reply wavs; `npm run doctor` reports each check; `SETUP.md` covers Windows from zero (Node, Python venv, ffmpeg, Discord app + intents, `.env`).
**Checkpoint M1:** the report shows a simulated hear → think → speak timeline; locally the owner can `/join` and talk to the bot after following SETUP.md.

## M2 — Conversation feel
- [ ] **M2.1 Persona + settings** · 1.5h
  - **Done:** Test: `persona.md` default loaded as the system prompt, `/persona reload`; `settings.json` read/write with defaults; tests.
- [ ] **M2.2 Conversation memory + speaker names** · 1.5h
  - **Done:** Test: per-channel history bounded to N turns; messages tagged with display names; cleared on leave.
- [ ] **M2.3 Streaming pipeline (first word fast)** · 2h
  - **Done:** Test: TTS of sentence 1 starts before the LLM finishes; timeline test with delayed fakes shows overlap and ≤ 300 ms gaps.
- [ ] **M2.4 Answers-everything policy + self/bot guard** · 1.5h
  - **Done:** Test: every accepted human utterance gets a reply; own and other bots' audio ignored; junk transcripts (<2 words, filler-only like "uh") dropped; 1.5 s turn gap honoured.
- [ ] **M2.5 Barge-in** · 2h ⚠️D5
  - **Done:** Test: speech start during playback stops it within 300 ms (fake clock), clears the queue, and the interrupter's utterance is handled next; D5 B/C variants are config switches.
- [ ] **M2.6 Multi-speaker queue** · 2h
  - **Done:** Test: overlapping utterances from 3 users are answered in arrival order without overlapping speech or duplicate replies.
- [ ] **M2.7 `/hush` and `/status`** · 1.5h
  - **Done:** Test: hush stops replies but keeps listening; status shows channel, voice, sidecar health, last latency numbers.
- [ ] **M2.8 Latency metrics** · 1.5h
  - **Done:** Test: each turn records STT, first-sentence LLM, first-TTS-audio, first-word totals; rolling stats feed `/status` and the build report.
- [ ] **M2.9 Reply-length enforcement** · 1h
  - **Done:** Test: prompt asks for 1–2 sentences; hard cap at 80 words cuts at a sentence boundary.
**Checkpoint M2:** simulated multi-person conversation timeline in the report; locally, the bot banters, stops when interrupted and never answers itself.

## M3 — Two voices
- [ ] **M3.1 Voice abstraction + `/voice`** · 1.5h
  - **Done:** Test: `fast` and `clone` voices selectable by command and persisted in settings; falls back to `fast` if clone isn't ready.
- [ ] **M3.2 XTTS-v2 engine in the sidecar** · 2h
  - **Done:** Test: pytest with mocked model; lazy load, unload after idle (fake clock), streaming-friendly chunks.
- [ ] **M3.3 Voice samples folder + `/voices`** · 2h
  - **Done:** Test: scans `voices/*.wav`, validates length (5–30 s) and format, `/voices` lists and selects; tests.
- [ ] **M3.4 VRAM guard** · 1.5h
  - **Done:** Test: sidecar reports GPU memory; refuses clone load when free VRAM is too low and says so by voice and in `/status`.
- [ ] **M3.5 Clone quality and latency pass** · 2h
  - **Done:** Test: sentence-level clone TTS with warm-up on `/voice clone`; measured latency recorded in the report from simulation; Owner check for the real number.
- [ ] **M3.6 Voice docs** · 1h
  - **Done:** Test: SETUP.md explains how to record a sample and pick a Piper voice.
**Checkpoint M3:** the owner can switch voices with `/voice` and hear their own cloned sample.

## M4 — Robustness
- [ ] **M4.1 Voice reconnect and DAVE recovery** · 2h
  - **Done:** Test: simulated disconnects and DAVE failures rejoin with backoff; no crash.
- [ ] **M4.2 Error speech and degraded modes** · 1.5h
  - **Done:** Test: Gemini 429/5xx/safety and sidecar-down produce one in-persona apology each, then recovery; no loops.
- [ ] **M4.3 Auto-leave when alone** · 1h
  - **Done:** Test: leaves after 5 min with no humans; resources freed.
- [ ] **M4.4 Start scripts** · 1.5h
  - **Done:** Test: `start.ps1` creates the sidecar venv, installs requirements, starts both processes, and stops both cleanly (shell syntax checked in CI; real run is an Owner check).
- [ ] **M4.5 Logging and privacy** · 1.5h
  - **Done:** Test: secrets are redacted; audio is never written to disk outside simulate/debug; transcripts only at debug level.
- [ ] **M4.6 Transcript mirror (optional)** · 1.5h ⚠️D10
  - **Done:** Test: when enabled, posts "heard/said" lines to a configured text channel with rate limiting.
**Checkpoint M4:** the bot survives restarts, drops and failures during a long session.

## M5 — Release candidate
- [ ] **M5.1 Full simulated soak** · 2h
  - **Done:** Test: 200 simulated turns with random overlaps and faults; no leaks, hangs or crashes.
- [ ] **M5.2 Latency budget test** · 1.5h
  - **Done:** Test: with realistic fake delays the first word lands within 2 s.
- [ ] **M5.3 Security and secrets review** · 1h
  - **Done:** Test: repo grep finds no tokens/keys; `.env` ignored; logs redacted.
- [ ] **M5.4 Docs and README polish** · 1.5h
  - **Done:** Test: README, SETUP.md and CLAUDE.md match the real commands and config.
- [ ] **M5.5 Final QA pass** · 1h
  - **Done:** Test: `npm run check` and smoke pass; milestone review done; status set to Release candidate.
**Checkpoint M5:** release candidate; the owner runs the real bot and sends feedback.

## Parked (not scheduled)
- Ollama provider for local Llama 3 [D12] · addressed-only mode · music/soundboard · web dashboard · per-user long-term memory.
- Owner checks (optional): run `npm run listen-test` and `npm run doctor` locally and paste the output in FEEDBACK.md.
