---
description: Connect this machine's Claude Code to an ExMuseMe workspace with the code from the app
argument-hint: <join code>
---

Connect this machine's Claude Code to ExMuseMe. The join code is: $ARGUMENTS

If no code was given above, ask the user for the code shown in the ExMuseMe app (their workspace → Connect Claude
Code) and stop there.

Otherwise run exactly this one command, with the code in place of CODE:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/exmuseme.mjs" connect CODE
```

Then tell the user what it printed, in one or two sentences. Never print or repeat anything from
`~/.exmuseme/claude-code.json`; it holds the connection's key.
