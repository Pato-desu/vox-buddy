# Vox Buddy
Discord voice bot: hears people in a voice channel, answers out loud (Gemini brain, local speech). Built by the autodev routine. The owner reviews demos, not code.
## Source of truth
- SPEC.md (what), DECISIONS.md (choices), TASKS.md (plan, tasks of 2 h or less closed by their Done check), AUTODEV.md (status), FEEDBACK.md (owner inbox; only the owner edits it).
- Tie-breaker when the spec is silent: a friend hanging out in a Discord call (feel, pacing, brevity), not an assistant. An explicit SPEC.md decision always wins.
- "(proposal)" items can change. Owner decisions change only with owner input.
- Routine runs follow .autodev/PROTOCOL.md.
## Tech
- Stack: TypeScript (Node 24, ESM) with discord.js v14 + @discordjs/voice (DAVE voice encryption is mandatory on Discord; the old Python attempt failed on it), plus a Python 3.11 FastAPI speech sidecar (faster-whisper STT, Piper TTS, Coqui XTTS-v2 for cloning). Gemini via @google/genai. vitest, eslint, pytest. Tunable numbers live in src/config.ts.
- Commands: `npm run check` (typecheck, lint, tests incl. sidecar pytest, build) · `npm run demo` (writes dist/demo.html, a build report page) · `npm run smoke` (headless check of the report and screenshots) · `npm run simulate` · `npm run doctor` · `npm run listen-test` (needs Discord) · `.\start.ps1` (Windows: sidecar + bot). Update these when they change.
- Demo page limits: one self-contained page fragment of 15 MB or less; no external requests except Google Fonts; no eval or new Function; assets made in code or inlined. The demo is a build report, because the bot needs Discord, a GPU and secrets (see SPEC §10).
- Cloud runs have no Discord, GPU, secrets or real models. Verify with fakes, generated fixtures and `simulate`; real-stack checks are Owner checks.
## Definition of done
- The check command and the smoke test pass, with no console errors. Logic has tests. No secret is ever committed or logged.
## Environment notes
- Cloud runs: Linux VM with the default "Trusted" network (package registries, GitHub, *.googleapis.com). Node here is v22 (engines >=22). Headless browser: Playwright (npm devDependency) with the preinstalled Chromium at /opt/pw-browsers/chromium via executablePath (`npm run smoke` picks it up; override with CHROMIUM_PATH). Do not run `playwright install`. Python 3.11 is installed but pytest/fastapi/httpx may be missing: `pip install pytest fastapi httpx` (otherwise `npm run check` skips the sidecar tests with a notice). `LOG_LEVEL=debug` also logs transcripts.
## Owner
- Writes in English. Owner-facing notes are in English. Notify: through the run's session, no email. Run budget: 90 min.
- Commits end with: Co-Authored-By: Claude <noreply@anthropic.com>
