# Vox Buddy: autodev status
Demo: https://claude.ai/artifact/JofBGxzeGs9fYLxupWpoo1 · Branch: claude/autodev · Runs: 4 a day (see routine)
Status: M1 done (16/42 tasks) · Build 2 · Last run 2026-10-02 06:45 UTC: M0.1–M1.10
## Look at this (2 min)
- Open the demo link: Build 1 report with progress per milestone (now a generated page).
## Waiting for you
- Nothing blocks. Defaults applied for D5 (barge-in), D7 (English), D10 (no transcript mirror), D12 (Ollama later). Answer in FEEDBACK.md only if you disagree.
## Owner to-do
- Before you can run the bot locally (SETUP.md arrives with M1): create `.env` on your PC with DISCORD_TOKEN, GOOGLE_API_KEY, GUILD_ID. Do not put them in the repo.
## Owner checks (optional)
- Follow SETUP.md, run `npm run doctor` and `npm run listen-test`, paste the output in FEEDBACK.md. Proves DAVE receive and the real engines.
## Decisions taken (for review)
- D6 one reply at a time, D8 `/join` plus optional auto-join, D9 runs on your PC, D11 secrets local only.
## Blocked
## Milestone reviews
- M1 (self-review, no subagent): timeline renders cleanly on phone and desktop; first word 1.4 s in simulation. Should-fix: real DAVE receive and real engines are unverified (Owner check below). Idea: draw the 2 s budget marker on the timeline.
- M0: self-review of desktop and phone screenshots; page readable, no overflow, no console errors. Nothing must-fix.
## Feedback log
feedback-sha: none
Last notified: 2026-10-02
## Next run
M2 Conversation feel, starting at M2.1.
