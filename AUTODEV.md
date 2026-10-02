# Vox Buddy: autodev status
Demo: https://claude.ai/artifact/JofBGxzeGs9fYLxupWpoo1 · Branch: claude/autodev · Runs: 4 a day (see routine)
Status: M3 done (31/42 tasks) · Build 4 · Last run 2026-10-02 14:15 UTC: M2.1–M3.6
## Look at this (2 min)
- Open the demo link: Build 4 adds a fast vs clone voice comparison (simulated) under the group chat.
## Waiting for you
- Nothing blocks. Defaults applied for D5 (barge-in), D7 (English), D10 (no transcript mirror), D12 (Ollama later). Answer in FEEDBACK.md only if you disagree.
## Owner to-do
- Before you can run the bot locally (SETUP.md arrives with M1): create `.env` on your PC with DISCORD_TOKEN, GOOGLE_API_KEY, GUILD_ID. Do not put them in the repo.
## Owner checks (optional)
- After M3: put a 10-20 s wav in voices/, `/voices use <name>`, talk; paste the first-word time from `/status` in FEEDBACK.md. XTTS needs an NVIDIA GPU with ~4 GB free.
- After M2: `/join`, talk over the bot (should stop), `/hush`, `/status`, edit persona.md then `/persona reload`.
- Follow SETUP.md, run `npm run doctor` and `npm run listen-test`, paste the output in FEEDBACK.md. Proves DAVE receive and the real engines.
## Decisions taken (for review)
- D5 barge-in locked to default A (stop at once; `bargeInMode` in src/config.ts). Replies hard-capped at 80 words.
- D6 one reply at a time, D8 `/join` plus optional auto-join, D9 runs on your PC, D11 secrets local only.
## Blocked
## Milestone reviews
- M3 (self-review, no subagent): new voices table readable on desktop and phone, no console errors. Should-fix: clone latency is a placeholder until measured on your GPU (Owner check). Idea: let `/voices use` preview the voice with a test line.
- M2 (self-review, no subagent): group-chat section and latency table readable on phone, no overflow or console errors. Should-fix: barge-in has no echo/noise guard, so a loud room may cut the bot off; needs a real-call Owner check. Idea: tune `bargeInMode` per room.
- M1 (self-review, no subagent): timeline renders cleanly on phone and desktop; first word 1.4 s in simulation. Should-fix: real DAVE receive and real engines are unverified (Owner check below). Idea: draw the 2 s budget marker on the timeline.
- M0: self-review of desktop and phone screenshots; page readable, no overflow, no console errors. Nothing must-fix.
## Feedback log
feedback-sha: df462b2e7a62bb13a35e5f77af3cfd4651d6e792
Last notified: 2026-10-02
## Next run
M4 Robustness, starting at M4.1.
