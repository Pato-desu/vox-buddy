# Vox Buddy: autodev status
Demo: https://claude.ai/artifact/JofBGxzeGs9fYLxupWpoo1 · Branch: claude/autodev · Runs: 4 a day (see routine)
Status: Release candidate: waiting for owner feedback (42/42 tasks) · Build 6 · Last run 2026-10-02 14:50 UTC: M2.1–M5.5
## Look at this (2 min)
- Open the demo link: Build 6 is the release candidate; the page shows the simulated timeline, group chat, latency and voices. The real test is on your PC (see Owner checks).
## Waiting for you
- Nothing blocks. Defaults applied for D5 (barge-in), D7 (English), D10 (no transcript mirror), D12 (Ollama later). Answer in FEEDBACK.md only if you disagree.
## Owner to-do
- Before you can run the bot locally (SETUP.md arrives with M1): create `.env` on your PC with DISCORD_TOKEN, GOOGLE_API_KEY, GUILD_ID. Do not put them in the repo.
## Owner checks (optional)
- Release candidate: `.\start.ps1`, `/join`, talk, talk over it, `/status`. Paste what felt wrong in FEEDBACK.md. You can pause the routine at claude.ai/code/routines.
- After M4: `.\start.ps1` on your PC, `/join`, stop and restart the sidecar mid-call, confirm the bot recovers and apologises once.
- After M3: put a 10-20 s wav in voices/, `/voices use <name>`, talk; paste the first-word time from `/status` in FEEDBACK.md. XTTS needs an NVIDIA GPU with ~4 GB free.
- After M2: `/join`, talk over the bot (should stop), `/hush`, `/status`, edit persona.md then `/persona reload`.
- Follow SETUP.md, run `npm run doctor` and `npm run listen-test`, paste the output in FEEDBACK.md. Proves DAVE receive and the real engines.
## Decisions taken (for review)
- D5 barge-in locked to default A (stop at once; `bargeInMode` in src/config.ts). Replies hard-capped at 80 words.
- D10 transcript mirror locked to default A (off; `/mirror on` per channel).
- D6 one reply at a time, D8 `/join` plus optional auto-join, D9 runs on your PC, D11 secrets local only.
## Blocked
## Milestone reviews
- M5 / final QA (independent subagent): must-fix found and fixed: utterances never ended with real Discord audio (streams end without silence frames); join/leave race; mirror privacy; auto-join, /hush off and one-word answers added. Not fixed (should-fix): apologies are saved to memory as if Gemini said them; a moderator kicking the bot makes it rejoin up to 5 times; stale `cloneReady` after a sidecar restart; STT ignores abort.
- M4 (self-review, no subagent): page unchanged visually, smoke green. Should-fix: M5.1 soak must exercise reconnect/failure paths together; start.ps1 is only syntax-checked here (Owner check).
- M3 (self-review, no subagent): new voices table readable on desktop and phone, no console errors. Should-fix: clone latency is a placeholder until measured on your GPU (Owner check). Idea: let `/voices use` preview the voice with a test line.
- M2 (self-review, no subagent): group-chat section and latency table readable on phone, no overflow or console errors. Should-fix: barge-in has no echo/noise guard, so a loud room may cut the bot off; needs a real-call Owner check. Idea: tune `bargeInMode` per room.
- M1 (self-review, no subagent): timeline renders cleanly on phone and desktop; first word 1.4 s in simulation. Should-fix: real DAVE receive and real engines are unverified (Owner check below). Idea: draw the 2 s budget marker on the timeline.
- M0: self-review of desktop and phone screenshots; page readable, no overflow, no console errors. Nothing must-fix.
## Feedback log
feedback-sha: df462b2e7a62bb13a35e5f77af3cfd4651d6e792
Last notified: 2026-10-02 (release candidate)
## Next run
Nothing open. Idle until owner feedback; then handle it per the protocol. Parked should-fix items from the final QA are candidates for follow-up tasks.
