---
description: Take the next ExMuseMe task given to this machine's Claude Code and work it
---

1. List the tasks:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/exmuseme.mjs" tasks
```

2. Pick the oldest task in `todo` (skip anything already in `doing`: another session has it). If there is none,
   say so and stop.
3. Mark it `doing`: `node "${CLAUDE_PLUGIN_ROOT}/scripts/exmuseme.mjs" task <num> doing`
4. Do the work the task describes, the way you would if the user had asked you directly. When you need a decision
   that is theirs, ask through their inbox with the exmuseme skill's `ask` command.
5. Finish with `task <num> done "<what changed>"`, or `task <num> blocked "<what you need>"` if you can't go on.
