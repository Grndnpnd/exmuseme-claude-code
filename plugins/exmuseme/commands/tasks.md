---
description: The ExMuseMe tasks given to this machine's Claude Code
---

Run this and show the user the open tasks it lists, briefly:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/exmuseme.mjs" tasks
```

If there are tasks, ask which one to take (or offer the oldest to-do). Don't take one another session has in `doing`.
