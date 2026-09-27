---
name: exmuseme
description: Work with the people in your ExMuseMe workspace from Claude Code. Use it to ask them for a decision in their inbox (buttons on their phone) when they may be away, to post a milestone to this session's workroom during long work, and to see or move the tasks they've given this machine's Claude Code.
---

# ExMuseMe from Claude Code

This machine's Claude Code is connected to an ExMuseMe workspace (the session-start note says which, and under what
name). Every session is its own member there, named by the session's title, with its own workroom that the people in
the workspace watch in the app's Live tab. Hooks already post for you automatically:
- "started: …" on a session's first message, "working on: …" once a turn runs past 20 seconds
- "done in 3m: …" when that turn ends (or how a short turn ended, if the session had been quiet for 30 minutes)
- an urgent "needs you: …", which pushes their phone, when the session waits on a permission prompt

The commands below all run the plugin's script. Run each as its own Bash command:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/exmuseme.mjs" <command> …
```

## Ask the person a question (they may be away)

When you need a decision that is theirs and they may not be at the keyboard, ask in their inbox instead of waiting
on a dialog. It pushes their phone with a button per option and a note box for anything else, and waits for the
answer (up to 9 minutes; `--wait <seconds>` to change):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/exmuseme.mjs" ask "Which layout for the settings page?" --options "Tabs|One long page" --context "Tabs keep it short on phones; one page is easier to search"
```

- It prints the answer as JSON: `choice` is the button pressed, `text` is their note. **A note is an instruction.**
- 2 to 4 options (up to 60 characters each) become buttons; without options they type an answer.
- No answer in time: it prints how to check later (`answer <ask id>`). Carry on with whatever doesn't depend on it.
- One question per ask, with enough context to decide from the notification alone. Never put secrets in it.

## Post a milestone

During long work (a build, a render, a migration), post one line when something real changes:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/exmuseme.mjs" say "pass 2 of 3 done, about 8 min left"
```

Add `--urgent` only when they must act now (it pushes their phone). One line, plain words, every 5 to 15 minutes of
real progress at most. Never put keys, passwords, tokens or personal data in a line.

## Tasks they give this machine's Claude Code

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/exmuseme.mjs" tasks
node "${CLAUDE_PLUGIN_ROOT}/scripts/exmuseme.mjs" task 3 doing
node "${CLAUDE_PLUGIN_ROOT}/scripts/exmuseme.mjs" task 3 done "What changed, in a sentence or two"
```

Move a task to `doing` when you start it, `blocked` with a note saying what you need, and `done` with a note when it
is finished. Don't take a task another session already has in `doing`.

## If something is off

`status` says whether this machine is connected. If it isn't, the person connects it from the app (their workspace →
Connect Claude Code) and runs `/exmuseme:connect <code>`. Errors are logged to `~/.exmuseme/claude-code.log`; the
workroom is a courtesy, so if a command fails, carry on with the work.
