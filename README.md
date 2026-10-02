# Vox Buddy
A Discord bot that sits in a voice channel, hears everyone, and talks back like a quick-witted friend. Gemini thinks; speech recognition and voice synthesis run on your own PC.
- Demo (private build report): https://claude.ai/artifact/JofBGxzeGs9fYLxupWpoo1
- Status: AUTODEV.md · Spec: SPEC.md · Decisions: DECISIONS.md · Plan: TASKS.md
- Feedback: add a line to FEEDBACK.md
Built by an autonomous Claude routine, 4 runs a day.

## Run it
Follow SETUP.md (Windows, from zero), then `.\start.ps1` starts the speech sidecar and the bot together. In Discord, join a voice channel and type `/join`.

## Slash commands
| Command | What it does |
|---|---|
| `/join` | Join your voice channel and start listening |
| `/leave` | Leave the channel (also automatic after 5 min alone) |
| `/hush` | Stop answering but keep listening; run again to resume |
| `/status` | Channel, voice in use, sidecar health, GPU memory, latency |
| `/voice fast\|clone` | Quick offline Piper voice, or your cloned voice |
| `/voices list\|use <name>` | Show or pick a clone sample from `voices/` |
| `/persona reload` | Re-read `persona.md` (how the bot talks) |
| `/mirror on\|off` | Post what it heard and said to a text channel (off by default) |

## Files you can edit
- `persona.md`: the bot's personality (system prompt).
- `voices/*.wav`: 5-30 s clean samples for the clone voice.
- `settings.json`: written by the bot (voice, selected sample, mirror channel); git-ignored.
- `src/config.ts`: every tunable number (silence timing, reply length, barge-in mode, latency budget).
- `.env`: `DISCORD_TOKEN`, `GOOGLE_API_KEY`, `GUILD_ID`. Optional: `LOG_LEVEL` (`debug` also logs transcripts), `SIDECAR_URL`.

## Developer commands
`npm run check` (typecheck, lint, tests incl. sidecar pytest, build) · `npm run demo` (build report page) · `npm run smoke` (headless check of the report) · `npm run simulate` (whole pipeline with fake engines) · `npm run doctor` (checks your setup) · `npm run listen-test` (receive-only test in a real call).

## Privacy
Audio is processed in memory and never saved. Only transcript text goes to Gemini. Logs redact keys, and what people said appears in logs only at `LOG_LEVEL=debug`.
