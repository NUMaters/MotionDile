#!/usr/bin/env node
/**
 * `npm run dev:all` の実体。
 * concurrently は環境によって起動時にハングするため、Node の spawn で 3 プロセスを直接起動する。
 * Vite は pipe だとログが長時間バッファされるため stdio を inherit にする（プレフィックスなし）。
 * いずれか 1 つが終了したら他を SIGTERM（concurrently -k に相当）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, delimiter } from 'node:path';
import { existsSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const RESET = '\x1b[0m';
const COLORS = {
  game: '\x1b[34m',
  agent: '\x1b[35m',
  frontend: '\x1b[32m',
};

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let shuttingDown = false;

function prefixLines(stream, writeLine) {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  rl.on('line', writeLine);
}

function killAllChildren() {
  for (const c of children) {
    if (c.exitCode !== null || c.signalCode) continue;
    try { c.kill('SIGTERM'); } catch { /* ignore */ }
  }
}

function onOneExited(code, signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  killAllChildren();
  const exitCode = signal ? 1 : (code ?? 0);
  setTimeout(() => process.exit(exitCode), 100);
}

function spawnDev({ name, cmd, args, cwd: childCwd }) {
  const color = COLORS[name] ?? '';
  const tag = `${color}[${name}]${RESET} `;
  const inheritIo = name === 'frontend';

  const child = spawn(cmd, args, {
    cwd: childCwd || root,
    stdio: inheritIo ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  if (!inheritIo) {
    prefixLines(child.stdout, (line) => process.stdout.write(`${tag}${line}\n`));
    prefixLines(child.stderr, (line) => process.stderr.write(`${tag}${line}\n`));
  }

  child.on('error', (err) => {
    console.error(`[dev:all] ${name} 起動失敗:`, err);
    if (!shuttingDown) { shuttingDown = true; killAllChildren(); process.exit(1); }
  });
  child.on('exit', onOneExited);
  children.push(child);
}

// ─── air バイナリの探索（run-air.mjs と同じロジック） ───
function resolveAirBinary() {
  const binaryName = process.platform === 'win32' ? 'air.exe' : 'air';
  if (process.env.AIR_BIN && existsSync(process.env.AIR_BIN)) return process.env.AIR_BIN;
  const goEnvResult = spawnSync('go', ['env', '-json', 'GOBIN', 'GOPATH'], { encoding: 'utf8' });
  let goEnv = {};
  try { goEnv = JSON.parse(goEnvResult.stdout); } catch { /* ignore */ }
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean);
  if (goEnv.GOBIN) dirs.push(goEnv.GOBIN);
  if (goEnv.GOPATH) for (const p of goEnv.GOPATH.split(delimiter)) { if (p) dirs.push(join(p, 'bin')); }
  for (const d of dirs) {
    const c = join(d, binaryName);
    if (existsSync(c)) return c;
  }
  return null;
}

const airBin = resolveAirBinary();
if (!airBin) {
  console.error('[dev:all] air が見つかりません。\n  → go install github.com/air-verse/air@latest\n');
  process.exit(1);
}

const vite = join(root, 'node_modules/vite/bin/vite.js');

console.log('\n[dev:all] game(8090)・agent(8091)・Vite(5173) を起動します…\n');

spawnDev({ name: 'game',     cmd: airBin, args: ['-c', '.air.toml'], cwd: resolve(root, 'game/backend') });
spawnDev({ name: 'agent',    cmd: airBin, args: ['-c', '.air.toml'], cwd: resolve(root, 'Agent') });

console.log(`${COLORS.frontend}[frontend]${RESET} Vite のログは以下（行バッファ回避のためプレフィックスなし）\n`);
spawnDev({ name: 'frontend', cmd: process.execPath, args: [vite], cwd: root });

process.on('SIGINT', () => { shuttingDown = true; killAllChildren(); process.exit(130); });
process.on('SIGTERM', () => { shuttingDown = true; killAllChildren(); process.exit(143); });
