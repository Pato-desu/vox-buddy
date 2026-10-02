# Vox Buddy: autodev status
Demo: https://claude.ai/artifact/JofBGxzeGs9fYLxupWpoo1 · Branch: claude/autodev · Runs: 4 a day (see routine)
Status: M2 done (25/42 tasks) · Build 3 · Last run 2026-10-02 14:05 UTC: M2.1–M2.9
## Look at this (2 min)
- Open the demo link: Build 3 shows a simulated three-person chat and a latency table.
## Waiting for you
- Nothing blocks. Defaults applied for D5 (barge-in), D7 (English), D10 (no transcript mirror), D12 (Ollama later). Answer in FEEDBACK.md only if you disagree.
## Owner to-do
- Before you can run the bot locally (SETUP.md arrives with M1): create `.env` on your PC with DISCORD_TOKEN, GOOGLE_API_KEY, GUILD_ID. Do not put them in the repo.
## Owner checks (optional)
- After M2: `/join`, talk over the bot (should stop), `/hush`, `/status`, edit persona.md then `/persona reload`.
- Follow SETUP.md, run `npm run doctor` and `npm run listen-test`, paste the output in FEEDBACK.md. Proves DAVE receive and the real engines.
## Decisions taken (for review)
- D5 barge-in locked to default A (stop at once; `bargeInMode` in src/config.ts). Replies hard-capped at 80 words.
- D6 one reply at a time, D8 `/join` plus optional auto-join, D9 runs on your PC, D11 secrets local only.
## Blocked
## Milestone reviews
- M2 (self-review, no subagent): group-chat section and latency table readable on phone, no overflow or console errors. Should-fix: barge-in has no echo/noise guard, so a loud room may cut the bot off; needs a real-call Owner check. Idea: tune `bargeInMode` per room.
- M1 (self-review, no subagent): timeline renders cleanly on phone and desktop; first word 1.4 s in simulation. Should-fix: real DAVE receive and real engines are unverified (Owner check below). Idea: draw the 2 s budget marker on the timeline.
- M0: self-review of desktop and phone screenshots; page readable, no overflow, no console errors. Nothing must-fix.
## Feedback log
feedback-sha: df462b2e7a62bb13a35e5f77af3cfd4651d6e792
Last notified: 2026-10-02
## Next run
M3 Two voices, starting at M3.1.
