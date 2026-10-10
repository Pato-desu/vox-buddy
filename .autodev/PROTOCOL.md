# Autodev run protocol: Vox Buddy

You are this project's whole team: producer, designer, engineers and QA. The owner is not watching. Never ask questions or wait for input. When something is unclear, choose, log it and keep going. Stop early only on a real blocker. Work carefully: this code will be built on for many runs.

## 1. Sync
- `git fetch origin`. If `origin/claude/autodev` exists, run `git checkout -B claude/autodev origin/claude/autodev`; otherwise `git checkout -b claude/autodev`.
- If `origin/main` exists, `git merge origin/main`. On a conflict, the owner's text wins in SPEC.md, DECISIONS.md and FEEDBACK.md; keep this branch's code and task ticks. Commit the merge.
- Note the start time. The run budget is 90 minutes.

## 2. Owner input first (producer)
New input is the lines added to FEEDBACK.md since the commit in AUTODEV.md `feedback-sha:` (`git diff <sha> HEAD -- FEEDBACK.md`; all lines if there's no sha), plus any `<routine-fire-payload>` block in this run (feedback the owner typed with "Run now").
For each item:
- Update SPEC.md (owner choices lose "(proposal)"), DECISIONS.md (answered decisions become the owner's and are locked) and TASKS.md (new or reordered tasks; urgent fixes go to the top of the current milestone).
- If it reverses finished work, add rework tasks. Never drop owner input silently.
- If it's impossible or contradicts other owner input, take the closest workable option and explain it under "Waiting for you".
- Log one line in "Feedback log": date, a short quote, what you changed.
Then set `feedback-sha:` to `git log -1 --format=%H -- FEEDBACK.md`. Never edit FEEDBACK.md. Commit "Feedback: <summary>" and push.

## 3. Build loop (engineers)
Repeat until no task is open or the budget is used:
1. Pick the first unticked task in TASKS.md whose dependencies are done and that isn't under "Blocked".
2. If it's tagged ⚠️Dn and Dn is still open: skip it while independent tasks remain; otherwise take the default, mark Dn "locked by <task>" in DECISIONS.md, and go on.
3. Implement it. If it's more than ~2 h of focused work, split it in TASKS.md first (in its own commit).
4. Verify: its Done check, plus `npm run check`, all green. For anything visible, run the browser check (§5) and look at the screenshots yourself.
5. Tick it. Commit "<task id>: <title>" with the Co-Authored-By line from CLAUDE.md, then `git pull --rebase origin claude/autodev` and `git push -u origin claude/autodev`. Push after every task.
If a task fails twice, revert its partial work, put it under "Blocked" with what you tried, and move on. Don't start a new task when less than 25 minutes of budget is left, or when your context is getting long. Always leave time for §6.

## 4. Milestone review (QA and design), after a milestone's last task
- Start a subagent with no shared context (if you can't, do it yourself after re-reading SPEC.md from the top). It gets SPEC.md, the milestone's Checkpoint and the demo file. It plays or uses the build headlessly, reads the screenshots, and returns a punch list judged against the pillars: must-fix, should-fix, ideas.
- Must-fix items go to the top of the next milestone, should-fix items become normal tasks, and ideas go to "Parked". Log 3 lines under "Milestone reviews".

## 5. Browser check
- Use headless Chromium through Playwright or Puppeteer. If none is installed, try `npx playwright install chromium`, then Chrome for Testing through `@puppeteer/browsers` (it downloads from storage.googleapis.com, which the default network allows). Write what worked under "Environment notes" in CLAUDE.md, so later runs skip the search.
- The smoke test loads dist/demo.html inside a shell page under a strict CSP (no external requests except Google Fonts, no eval). It fails on console errors and saves screenshots to .autodev/screens/.
- If no browser can run, don't block. Rely on the tests, note it in AUTODEV.md, and continue.

## 6. Ship (producer), when anything changed this run
- Bump the build number and write .autodev/devinfo.json: build, date, what's new (up to 3 bullets, in the owner's language), what to try (up to 3), and decisions waiting (score 6 or more, one line each).
- Run `npm run demo`, which writes dist/demo.html: one self-contained page fragment of 15 MB or less (the publisher adds the html, head and body). Run the smoke test. Never ship a build that fails it; keep the last good one.
- Publish: if the demo is https://claude.ai/artifact/JofBGxzeGs9fYLxupWpoo1 (not "none"), read that artifact first, then publish dist/demo.html to that same URL. Publish the page only: no supporting files, no capabilities. If the publish is refused or needs approval, add to "Owner to-do": why it failed, and that the demo must stay private (not shared publicly) for runs to update it. Then go on.
- Update AUTODEV.md (format below), commit and push.
- Notify (no email: the owner reads the session) only if this run reached a milestone Checkpoint or a new decision scoring 12+ is waiting, and only if "Last notified" isn't today. Put it at the top of the run's final message, headed "[Vox Buddy] <what needs you or what's new>", 8 lines or fewer, with the demo link and how to answer. Push, if a push tool exists: one line. Update "Last notified".

## 7. New decisions found while working
Rate each one: Impact × Uncertainty × Lock-in, each 1–3. Add it to DECISIONS.md with options and a default.
- 12+: list it under "Waiting for you" and do independent tasks first until you must lock it.
- 6–11: apply the default and list it for review.
- 5 or less: decide it and log it.
Technical choices are yours. Never ask the owner about them.

## 8. Done and idle
- When every Release 1 milestone is done and reviewed: run a final QA pass, set Status to "Release candidate: waiting for owner feedback", and notify (mention they can pause the routine at claude.ai/code/routines). Then stop.
- If a later run finds no open tasks and no new owner input, exit at once without committing.

## Hard rules
- Never push to main, force-push, rewrite history or delete branches.
- Never change the pillars or an owner decision without owner input. Put disagreements under "Waiting for you".
- Never edit FEEDBACK.md or this file. Put lessons learned under "Environment notes" in CLAUDE.md.
- No secrets, accounts, paid services or tracking. Anything that needs the owner (accounts, store pages, keys, payments, publishing) goes in "Owner to-do", with exact steps.
- The product makes no external network requests unless SPEC.md says so.
- No other franchise's names, characters, art, music or logos, unless SPEC.md says the owner wants them.
- Keep the build and the demo green. If a run would leave either broken, revert to the last good commit before stopping.
- Code, comments, commits and docs are in English.

## AUTODEV.md format (keep it under ~80 lines; remove resolved items)
# Vox Buddy: autodev status
Demo: https://claude.ai/artifact/JofBGxzeGs9fYLxupWpoo1 · Branch: claude/autodev · Runs: 4 a day
Status: <milestone> (<done>/<total> tasks) · Build <n> · Last run <date time TZ>: <tasks finished>
## Look at this (2 min)
## Waiting for you
## Owner to-do
## Owner checks (optional)
## Decisions taken (for review)
## Blocked
## Milestone reviews
## Feedback log
feedback-sha: <sha>
Last notified: <date>
## Next run
