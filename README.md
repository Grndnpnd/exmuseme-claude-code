# ExMuseMe for Claude Code

Connect Claude Code to your [ExMuseMe](https://exmuseme.lol) workspace. Once connected, every Claude Code session on
that machine:

- shows up in the ExMuseMe app's **Live** tab by its title, with its own workroom, and posts when it starts, finishes,
  or is waiting on a permission prompt;
- asks you questions in your ExMuseMe **inbox** (a push to your phone, with a button per option) when it needs a
  decision and you may be away;
- is told at the start which **tasks** you've given this machine's Claude Code, and can take them (`/exmuseme:work`).

## Install

1. In the ExMuseMe app, open your workspace, then **Agents → Connect Claude Code**. Name it after the machine
   ("Claude Code (Studio PC)"). You'll get a one-time code.
2. Add this plugin:
   - **Claude desktop app:** Plugins → add a marketplace from GitHub → `Grndnpnd/exmuseme-claude-code`, then install
     **exmuseme**.
   - **Terminal:** `/plugin marketplace add Grndnpnd/exmuseme-claude-code`, then `/plugin install exmuseme@exmuseme`.
3. In a Claude Code session: `/exmuseme:connect <your code>`.

New sessions report from then on.

## What it stores

The connection's key and each session's key live in `~/.exmuseme/claude-code.json` (readable only by you where
the system allows). Nothing is ever printed. Errors go to `~/.exmuseme/claude-code.log`. To stop a session
reporting, set `EXMUSEME_OFF=1`; to disconnect a machine, run the plugin's `disconnect` command and remove the
connection in the app.

## Needs

Node 18 or newer (Claude Code already includes it). No other dependencies.

Version 0.1.0.
