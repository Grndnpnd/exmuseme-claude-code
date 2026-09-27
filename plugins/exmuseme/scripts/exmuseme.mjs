#!/usr/bin/env node
/** ExMuseMe for Claude Code. One script, no dependencies (Node 18+), used by the plugin's hooks and commands.
 *
 *  Connect once:   exmuseme.mjs connect <join code>     (from the ExMuseMe app: Workspace → Connect Claude Code)
 *  Hooks:          exmuseme.mjs session-start | prompt | stop | notify   (hook input JSON on stdin)
 *  From a session: exmuseme.mjs say "<line>" [--urgent]
 *                  exmuseme.mjs ask "<question>" [--options "A|B"] [--context "..."] [--wait <s>]
 *                  exmuseme.mjs answer <ask id> [--wait <s>]
 *                  exmuseme.mjs tasks | task <num> <todo|doing|blocked|done> ["note"]
 *                  exmuseme.mjs status | disconnect
 *
 *  Each Claude Code session becomes its own member of the workspace, under this machine's connection, named by the
 *  session's title, with its own workroom. Keys live in ~/.exmuseme/claude-code.json (readable only by you where the
 *  system allows); nothing here ever prints a key. Hooks never fail the session: errors go to ~/.exmuseme/claude-code.log.
 *  EXMUSEME_OFF=1 silences a session. */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync, statSync, unlinkSync, renameSync, chmodSync, existsSync, openSync, readSync, closeSync, fstatSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename, resolve } from "node:path";

const HOME = process.env.EXMUSEME_HOME || join(homedir(), ".exmuseme");
const CONFIG = join(HOME, "claude-code.json");
const STATE = join(HOME, "cc-state");
const LOG = join(HOME, "claude-code.log");
const DELAY = Number(process.env.EXMUSEME_DELAY_MS ?? 20_000);  // a turn must run this long before it shows up
const QUIET = 30 * 60_000;     // a session quiet this long posts how a short turn ended
const URGENT_GAP = 10 * 60_000;
const CHECKIN_GAP = 5 * 60_000;
const UA = "exmuseme-claude-code/0.1";

const now = () => Date.now();
const log = (m) => { try { mkdirSync(HOME, { recursive: true }); appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`); } catch {} };
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return d; } };
function writeJson(f, v, secret = false) {
  mkdirSync(HOME, { recursive: true });
  const tmp = `${f}.tmp`;
  writeFileSync(tmp, JSON.stringify(v, null, 1), secret ? { mode: 0o600 } : undefined);
  renameSync(tmp, f);
  if (secret) { try { chmodSync(f, 0o600); } catch {} }
}
const config = () => readJson(CONFIG, null);
const saveConfig = (c) => writeJson(CONFIG, c, true);
const base = (c) => (process.env.EXMUSEME_URL || c?.base || "https://exmuseme.lol").replace(/\/+$/, "");

async function api(c, method, path, body, key, timeoutMs = 8000) {
  if (!key) return { status: 0, json: null };
  try {
    const r = await fetch(base(c) + path, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "user-agent": UA }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    return { status: r.status, json: await r.json().catch(() => null) };
  } catch (e) { log(`${method} ${path.split("?")[0]} failed: ${e?.name ?? "error"}`); return { status: 0, json: null }; }
}

// ───────────── text ─────────────
const SECRETS = [
  [/\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/\S+/gi, "$1://…"],
  [/\bbearer\s+\S+/gi, "Bearer …"],
  [/\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[abp]|nsec|exm)[-_][A-Za-z0-9_\-]{8,}/g, "…"],
  [/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS)[A-Z0-9_]*)\s*[=:]\s*\S+/gi, "$1=…"],
  [/[A-Za-z0-9+/_\-]{40,}={0,2}/g, "…"],
];
function clean(t, n = 240) {
  let s = String(t ?? "");
  for (const [rx, sub] of SECRETS) s = s.replace(rx, sub);
  s = s.replace(/```[\s\S]*?```/g, " ").replace(/<[^>]{1,80}>/g, " ").replace(/[`*#>|]+/g, "").replace(/\s+/g, " ").trim();
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}
const firstSentence = (t) => (String(t ?? "").trim().split(/(?<=[.!?])\s|\n/)[0] ?? "");
const dur = (ms) => { const s = Math.round(ms / 1000); return s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`; };

// ───────────── per-session state ─────────────
const sid = (ev) => String(ev.session_id ?? "nosession").replace(/[^A-Za-z0-9_-]/g, "");
const statePath = (ev) => join(STATE, `${sid(ev)}.json`);
const load = (ev) => readJson(statePath(ev), {});
function save(ev, st) { try { mkdirSync(STATE, { recursive: true }); writeJson(statePath(ev), st); } catch (e) { log(`state: ${e.message}`); } }
function sweep() {
  try { for (const f of readdirSync(STATE)) { const p = join(STATE, f); if (now() - statSync(p).mtimeMs > 2 * 86400_000) unlinkSync(p); } } catch {}
}

/** The last bytes of a file, as text. */
function tail(path, bytes) {
  const fd = openSync(path, "r");
  try { const size = fstatSync(fd).size, start = Math.max(0, size - bytes), buf = Buffer.alloc(size - start); readSync(fd, buf, 0, buf.length, start); return buf.toString("utf8"); }
  finally { closeSync(fd); }
}

/** The session's title in Claude Code, from its transcript. */
function titleOf(ev) {
  if (!ev.transcript_path) return null;
  try {
    const found = [...tail(ev.transcript_path, 2_000_000).matchAll(/"(?:customTitle|aiTitle|agentName)":"((?:[^"\\]|\\.){1,120})"/g)];
    return found.length ? JSON.parse(`"${found[found.length - 1][1]}"`) : null;
  } catch { return null; }
}

function lastReply(ev) {
  if (typeof ev.last_assistant_message === "string" && ev.last_assistant_message.trim()) return ev.last_assistant_message;
  if (!ev.transcript_path) return "";
  try {
    const lines = tail(ev.transcript_path, 400_000).split("\n").reverse();
    for (const l of lines) {
      let row; try { row = JSON.parse(l); } catch { continue; }
      if (row.type !== "assistant") continue;
      const c = row.message?.content;
      if (typeof c === "string" && c.trim()) return c;
      if (Array.isArray(c)) { const t = c.filter((b) => b?.type === "text").map((b) => b.text).join(" ").trim(); if (t) return t; }
    }
  } catch (e) { log(`transcript: ${e.message}`); }
  return "";
}

/** This session's member key, made on first use under the machine's connection. */
async function sessionKey(ev, st) {
  const c = config();
  if (!c?.connection?.key) return null;
  const s = sid(ev);
  if (c.sessions?.[s]?.key) return c.sessions[s].key;
  const name = clean(titleOf(ev) ?? "", 40) || `Session ${s.slice(0, 6)} in ${basename(ev.cwd || process.cwd())}`;
  const r = await api(c, "POST", "/v1/sessions", { session_id: s, name, rekey: !!c.sessions?.[s] }, c.connection.key);
  if (!r.json?.key?.token) { log(`session member: HTTP ${r.status} ${r.json?.error ?? ""}`); return null; }
  const fresh = config();
  fresh.sessions = { ...(fresh.sessions ?? {}), [s]: { key: r.json.key.token, name: r.json.member.name, at: now() } };
  saveConfig(fresh);
  return r.json.key.token;
}

async function post(ev, st, body, urgent = false) {
  if (process.env.EXMUSEME_OFF === "1") return;
  const key = await sessionKey(ev, st);
  if (!key) return;
  const r = await api(config(), "POST", "/v1/workroom", { body: body.slice(0, 1000), urgent }, key, 6000);
  if (r.status === 201) { const s = load(ev); s.last_post = now(); s.announced = true; save(ev, s); }
  else if (r.status) log(`workroom: HTTP ${r.status}`);
}

async function checkin(ev, st) {
  if (now() - (st.checkin_at ?? 0) < CHECKIN_GAP) return;
  const c = config(); const key = c?.sessions?.[sid(ev)]?.key;
  if (!key) return;
  st.checkin_at = now(); save(ev, st);
  await api(c, "GET", "/v1/me", undefined, key, 5000);
}

// ───────────── hook events ─────────────
const scheduled = (p) => /^\s*<scheduled-task name="([^"]+)"/.exec(p ?? "")?.[1] ?? null;
const gistOf = (p) => (/^\s*<task-notification/.test(p ?? "") ? "a background task finished" : clean(p, 160));

/** A new session: make its member, and tell it (the model) what's waiting for it. */
async function onSessionStart(ev) {
  const c = config();
  if (!c?.connection?.key) return;
  const st = load(ev); st.cwd = ev.cwd; save(ev, st); sweep();
  const r = await api(c, "GET", "/v1/tasks?mine=1", undefined, c.connection.key, 5000);
  const tasks = (r.json?.tasks ?? []).filter((t) => t.state !== "done");
  const me = c.connection.name ?? "Claude Code";
  const lines = [`This machine's Claude Code is connected to ExMuseMe as "${me}" in the workspace "${c.connection.workspace ?? "?"}". This session reports to its own workroom there automatically (start, done, needs-you), so the people in the workspace can follow it in the app's Live tab.`];
  if (tasks.length) {
    lines.push(`Open tasks given to "${me}" (${tasks.length}):`);
    for (const t of tasks.slice(0, 8)) lines.push(`  #${t.num} [${t.state}] ${clean(t.title, 120)}${t.creator ? ` (from ${t.creator})` : ""}`);
    lines.push("If the user hasn't given you something else, offer to take the next one (the exmuseme skill has the commands). Don't take a task another session is already doing.");
  }
  lines.push("When you need the person's decision and they may be away, ask through their ExMuseMe inbox (the exmuseme skill's ask command) rather than waiting on a dialog.");
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") } }));
}

async function onPrompt(ev) {
  const prompt = ev.prompt ?? "";
  let st = load(ev);
  const task = scheduled(prompt);
  if (task) st.task = task;
  const turn = now();
  Object.assign(st, { turn, stopped: false, posted: false, ask: gistOf(prompt), cwd: ev.cwd });
  save(ev, st); sweep();
  await checkin(ev, st);
  if (st.task) return; // scheduled runs stay quiet; only urgent notices get out
  await new Promise((r) => setTimeout(r, DELAY));
  st = load(ev);
  if (st.turn !== turn) return;
  if (!st.announced) {
    await post(ev, st, `started: ${st.ask}`);
    st = load(ev); st.posted = !st.stopped; save(ev, st);
  } else if (!st.stopped) {
    st.posted = true; save(ev, st);
    await post(ev, st, `working on: ${st.ask}`);
  }
}

async function onStop(ev) {
  const st = load(ev);
  if (!st.turn || st.stopped) return;
  st.stopped = true; save(ev, st);
  await checkin(ev, st);
  if (st.task) return;
  const took = now() - st.turn, quietLong = now() - (st.last_post ?? 0) > QUIET;
  if (!(st.posted || took >= DELAY || quietLong)) return;
  const gist = clean(firstSentence(lastReply(ev)), 220) || "(no reply text)";
  if (took >= DELAY || st.posted) await post(ev, st, `done in ${dur(took)}: ${st.posted ? "" : `${st.ask} → `}${gist}`);
  else await post(ev, st, gist);
}

async function onNotify(ev) {
  const msg = ev.message ?? "", kind = String(ev.notification_type ?? "").toLowerCase();
  if (kind.includes("idle") || /waiting for your input/i.test(msg)) return;
  if (kind && !["permission_prompt", "elicitation_dialog"].includes(kind) && !/permission/i.test(msg)) return;
  const st = load(ev);
  if (now() - (st.urgent_at ?? 0) < URGENT_GAP) return;
  st.urgent_at = now(); save(ev, st);
  await post(ev, st, `needs you: ${clean(msg, 200) || "waiting for permission"}`, true);
}

// ───────────── commands ─────────────
/** The session speaking from a command: the most recently active one in this folder, else anywhere. */
function currentSession() {
  const cwd = resolve(process.cwd());
  let best = null, bestT = 0, any = null, anyT = 0;
  try {
    for (const f of readdirSync(STATE)) {
      const s = readJson(join(STATE, f), {});
      if (s.task) continue;
      if ((s.turn ?? 0) > anyT) { any = f.replace(/\.json$/, ""); anyT = s.turn; }
      if (s.cwd && resolve(s.cwd) === cwd && (s.turn ?? 0) > bestT) { best = f.replace(/\.json$/, ""); bestT = s.turn; }
    }
  } catch {}
  return { session_id: best ?? any ?? "manual", cwd };
}

function flag(args, name, dflt) { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; }

async function cmdConnect(args) {
  const code = (args[0] ?? "").trim();
  if (!code) { console.log("usage: connect <join code> (from the ExMuseMe app: your workspace → Connect Claude Code)"); return; }
  const c = config() ?? {};
  const r = await fetch(`${base(c)}/v1/join`, { method: "POST", headers: { "content-type": "application/json", "user-agent": UA }, body: JSON.stringify({ code, expect: "connection" }) }).then(async (x) => ({ status: x.status, json: await x.json().catch(() => null) })).catch(() => ({ status: 0, json: null }));
  if (r.status !== 201 || !r.json?.key?.token) { console.log(`Could not connect: ${r.json?.error ?? `HTTP ${r.status}`}`); return; }
  saveConfig({ base: base(c), connection: { key: r.json.key.token, name: r.json.agent.name, workspace: r.json.workspace.name }, sessions: {} });
  console.log(`Connected: this machine's Claude Code is "${r.json.agent.name}" in ${r.json.workspace.name}. New sessions report to Live from now on (this one from its next message).`);
}

async function cmdStatus() {
  const c = config();
  if (!c?.connection?.key) { console.log("Not connected. In the ExMuseMe app: your workspace → Connect Claude Code, then run connect <code>."); return; }
  const r = await api(c, "GET", "/v1/me", undefined, c.connection.key);
  console.log(r.status === 200 ? `Connected as "${c.connection.name}" in ${c.connection.workspace} (${base(c)}); ${Object.keys(c.sessions ?? {}).length} sessions so far.` : `The connection's key no longer works (HTTP ${r.status}). Reconnect with a new code from the app.`);
}

async function cmdSay(args) {
  const urgent = args.includes("--urgent");
  const line = clean(args.filter((a) => a !== "--urgent").join(" "), 600);
  if (!line) { console.log('usage: say "<line>" [--urgent]'); return; }
  const ev = currentSession();
  await post(ev, load(ev), line, urgent);
  console.log("posted");
}

async function cmdAsk(args) {
  const opts = (flag(args, "--options", "") ?? "").split("|").map((o) => o.trim().slice(0, 60)).filter(Boolean).slice(0, 4);
  const ctx = flag(args, "--context", "");
  const wait = Math.max(0, Math.min(560, Number(flag(args, "--wait", "540")) || 0));
  const question = clean(args.join(" "), 480);
  if (question.length < 3) { console.log('usage: ask "<question>" [--options "A|B|C"] [--context "<why>"] [--wait 540]'); return; }
  const ev = currentSession();
  const key = await sessionKey(ev, load(ev));
  if (!key) { console.log("Not connected to ExMuseMe; ask in the chat instead."); return; }
  const r = await api(config(), "POST", "/v1/channels/desk/asks", { question, context: ctx ? clean(ctx, 3900) : "", expires_in: 86400, options: opts.length >= 2 ? { type: "choose", choices: opts } : { type: "text" } }, key);
  if (r.status !== 201) { console.log(`Could not ask (${r.json?.error ?? `HTTP ${r.status}`}); ask in the chat instead.`); return; }
  console.log(`Asked in the workspace's inbox (#${r.json.ask.num}, ${r.json.ask.id}); waiting up to ${wait}s.`);
  await printAnswer(key, r.json.ask.id, wait);
}

async function printAnswer(key, askId, wait) {
  const deadline = now() + wait * 1000;
  for (;;) {
    const left = Math.max(0, Math.round((deadline - now()) / 1000));
    const w = Math.max(1, Math.min(50, left));
    const r = await api(config(), "GET", `/v1/asks/${askId}?wait=${w}`, undefined, key, (w + 10) * 1000);
    const a = r.json?.ask;
    if (a?.state && a.state !== "open") { console.log(JSON.stringify({ state: a.state, choice: a.answer?.label ?? null, text: a.answer?.text ?? null, decision: a.answer?.decision ?? null })); return; }
    if (left <= 0) { console.log(`No answer yet. Check later with: answer ${askId}`); return; }
  }
}

async function cmdAnswer(args) {
  const wait = Math.max(0, Math.min(560, Number(flag(args, "--wait", "0")) || 0));
  if (!args[0]) { console.log("usage: answer <ask id> [--wait <seconds>]"); return; }
  const ev = currentSession();
  await printAnswer(await sessionKey(ev, load(ev)), args[0].replace(/[^A-Za-z0-9_]/g, ""), wait);
}

async function cmdTasks(args) {
  const c = config();
  if (!c?.connection?.key) { console.log("Not connected to ExMuseMe."); return; }
  if (!args.length) {
    const r = await api(c, "GET", "/v1/tasks?mine=1", undefined, c.connection.key);
    const ts = r.json?.tasks ?? [];
    if (!ts.length) console.log(`No open tasks for "${c.connection.name}".`);
    for (const t of ts) { console.log(`#${t.num} [${t.state}] ${t.title}${t.creator ? `  (from ${t.creator})` : ""}`); if (t.notes) console.log(`   ${t.notes.replace(/\n/g, "\n   ")}`); }
    return;
  }
  const [num, state, ...note] = args;
  if (!["todo", "doing", "blocked", "done"].includes(state)) { console.log('usage: task <num> <todo|doing|blocked|done> ["note"]'); return; }
  const n = String(num).replace(/^#/, "");
  if (note.length) await api(c, "POST", `/v1/tasks/${n}/notes`, { body: note.join(" ").slice(0, 4000) }, c.connection.key);
  const r = await api(c, "PATCH", `/v1/tasks/${n}`, { state }, c.connection.key);
  console.log(`task ${n}: ${r.json?.task?.state ?? r.json?.error ?? `HTTP ${r.status}`}`);
}

function cmdDisconnect() {
  if (existsSync(CONFIG)) unlinkSync(CONFIG);
  console.log("Disconnected on this machine. To cut the connection off entirely, remove it from the workspace in the app.");
}

// ───────────── main ─────────────
async function readStdin() {
  if (process.stdin.isTTY) return {};
  const chunks = []; for await (const ch of process.stdin) chunks.push(ch);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

const [cmd, ...args] = process.argv.slice(2);
try {
  const hooks = { "session-start": onSessionStart, prompt: onPrompt, stop: onStop, notify: onNotify };
  const cmds = { connect: cmdConnect, status: cmdStatus, say: cmdSay, ask: cmdAsk, answer: cmdAnswer, tasks: () => cmdTasks([]), task: cmdTasks, disconnect: cmdDisconnect };
  if (hooks[cmd]) await hooks[cmd](await readStdin());
  else if (cmds[cmd]) await cmds[cmd](args);
  else console.log("usage: connect <code> | status | say | ask | answer | tasks | task | disconnect");
} catch (e) { log(`${cmd} crashed: ${e?.stack ?? e}`); }
process.exit(0);
