#!/usr/bin/env node
// Starts/stops the local preview of the site in the background.
//   node serve.mjs              start (or reuse) the dev server and print its URL
//   node serve.mjs --prod       run the production server (after a build) - closest to the live site
//   node serve.mjs --status | --stop     --port 3005   --wait 240
// In the Claude desktop app prefer the built-in preview tools (.claude/launch.json) so the person can watch.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { requireRepo, loadConfig, scratchDir, readJson, writeJson, parseArgs, emit, run } from './lib.mjs';
import { resolveCommands } from './verify.mjs';

const args = parseArgs(process.argv.slice(2));
const root = requireRepo();
const { config } = loadConfig(root);
const stateFile = path.join(scratchDir(root, 'state'), 'server.json');
const state = readJson(stateFile);

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
// A port is busy if anything accepts a connection on IPv4 or IPv6 (dev servers often listen on "::" only).
const connects = (port, host) => new Promise((resolve) => {
  const sock = net.connect({ port, host });
  sock.once('connect', () => { sock.destroy(); resolve(true); });
  sock.once('error', () => resolve(false));
  sock.setTimeout(1500, () => { sock.destroy(); resolve(false); });
});
const portFree = async (port) => !(await connects(port, '127.0.0.1')) && !(await connects(port, '::1'));
// The URL the server itself printed ("Local: http://localhost:3001"), so we never check another project's server.
function urlFromLog(log) {
  try {
    const t = fs.readFileSync(log, 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
    const m = [...t.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})/g)].pop();
    return m ? `http://localhost:${m[1]}` : null;
  } catch { return null; }
}
async function responds(url) {
  try { const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) }); return r.status > 0; } catch { return false; }
}
// `next dev` (16.3+) writes AGENTS.md/CLAUDE.md for AI tools. Remove the ones this preview created.
function tidyToolFiles(st) {
  for (const f of ['AGENTS.md', 'CLAUDE.md']) {
    const abs = path.join(root, f);
    if (!fs.existsSync(abs) || (st.preexisting || []).includes(f)) continue;
    const tracked = run('git', ['ls-files', '--error-unmatch', '--', f], { cwd: root }).code === 0;
    const text = fs.readFileSync(abs, 'utf8');
    if (!tracked && (/nextjs-agent-rules/.test(text) || text.trim() === '@AGENTS.md')) fs.rmSync(abs, { force: true });
  }
}
function stop(st) {
  if (!st || !st.pid) return false;
  try { tidyToolFiles(st); } catch { /* best effort */ }
  try {
    if (process.platform === 'win32') run('taskkill', ['/pid', String(st.pid), '/T', '/F']);
    else process.kill(-st.pid, 'SIGTERM');
  } catch { try { process.kill(st.pid, 'SIGTERM'); } catch { /* gone */ } }
  return true;
}

async function main() {
  if (args.stop) {
    const ok = stop(state);
    fs.rmSync(stateFile, { force: true });
    emit({ ok: true, stopped: ok }, ok ? 'Local preview stopped.' : 'No preview started by this skill was running.');
    return;
  }
  if (args.status) {
    const up = state && alive(state.pid) && await responds(state.url);
    emit({ running: !!up, ...state }, up ? `Running: ${state.url} (${state.mode})` : 'Not running.');
    return;
  }
  const mode = args.prod ? 'prod' : 'dev';
  if (state && alive(state.pid) && state.mode === mode && await responds(state.url)) {
    emit({ ok: true, url: state.url, reused: true, mode }, `URL: ${state.url} (already running, ${mode})`);
    return;
  }
  if (state && alive(state.pid)) stop(state);

  const cmds = resolveCommands(root, config);
  const base = mode === 'prod' ? cmds.start : cmds.dev;
  if (!base) { emit({ ok: false }, `No ${mode === 'prod' ? 'start' : 'dev'} command is set up for this project (config commands.${mode === 'prod' ? 'start' : 'dev'}).`); process.exit(2); }
  // Never reuse a server this script did not start: it may be another project on the same port.
  let port = Number(args.port || (config.devServer && config.devServer.port) || 3000);
  const wanted = port;
  if (!(await portFree(port))) {
    let found = null;
    for (let p = port + 1; p < port + 50; p++) if (await portFree(p)) { found = p; break; }
    if (!found) { emit({ ok: false }, `Ports ${port}-${port + 49} are all in use. Stop another local server and try again.`); process.exit(2); }
    port = found;
  }
  const pm = config.packageManager || 'npm';
  const portArg = /\$PORT|--port|-p \d/.test(base) ? '' : (base.startsWith('npm ') ? ` -- --port ${port}` : ` --port ${port}`);
  const cmd = base + portArg;
  const log = path.join(scratchDir(root, 'logs'), `server-${mode}.log`);
  const fd = fs.openSync(log, 'w');
  const child = spawn(cmd, { cwd: root, shell: true, detached: process.platform !== 'win32', stdio: ['ignore', fd, fd], env: { ...process.env, PORT: String(port), NEXT_TELEMETRY_DISABLED: '1', BROWSER: 'none' } });
  child.unref();
  let url = `http://localhost:${port}`;
  const preexisting = ['AGENTS.md', 'CLAUDE.md'].filter((f) => fs.existsSync(path.join(root, f)));
  writeJson(stateFile, { pid: child.pid, url, port, mode, cmd, log, startedAt: new Date().toISOString(), pm, preexisting });
  const waitSec = Number(args.wait || 240);
  const t0 = Date.now();
  while (Date.now() - t0 < waitSec * 1000) {
    if (!alive(child.pid)) break;
    const printed = urlFromLog(log);
    if (printed) url = printed;
    // Ready only when our own process printed its address (or the chosen port was free before we started it).
    if ((printed || Date.now() - t0 > 20000) && await responds(url + '/')) {
      writeJson(stateFile, { pid: child.pid, url, port: Number(new URL(url).port), mode, cmd, log, startedAt: new Date().toISOString(), pm, preexisting });
      const moved = Number(new URL(url).port) !== wanted ? ` (port ${wanted} was busy with something else)` : '';
      emit({ ok: true, url, mode, log, seconds: Math.round((Date.now() - t0) / 1000) }, `URL: ${url}${moved} (${mode} server, ready in ${Math.round((Date.now() - t0) / 1000)}s; log: ${path.relative(root, log)})\nCheck the first page you open shows this website.`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  const tail = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').slice(-30).join('\n') : '';
  stop({ pid: child.pid });
  fs.rmSync(stateFile, { force: true });
  emit({ ok: false, log, tail }, `The local site did not start within ${waitSec}s. Last lines of ${path.relative(root, log)}:\n${tail}\n` +
    'Common causes: missing .env file (ask the developer for it), dependencies not installed (verify.mjs --install), or a code error in the change.');
  process.exit(2);
}

main();
