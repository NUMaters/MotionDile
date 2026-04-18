/**
 * scripts/resolve-air.mjs — air バイナリの探索（dev-all.mjs / run-air.mjs で共用）。
 */
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';

export function resolveAirBinary() {
  const binaryName = process.platform === 'win32' ? 'air.exe' : 'air';
  if (process.env.AIR_BIN && existsSync(process.env.AIR_BIN)) return process.env.AIR_BIN;

  const goEnvResult = spawnSync('go', ['env', '-json', 'GOBIN', 'GOPATH'], { encoding: 'utf8' });
  let goEnv = {};
  try { goEnv = JSON.parse(goEnvResult.stdout); } catch { /* ignore */ }

  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean);
  if (typeof goEnv.GOBIN === 'string' && goEnv.GOBIN.trim()) dirs.push(goEnv.GOBIN.trim());
  if (typeof goEnv.GOPATH === 'string') {
    for (const p of goEnv.GOPATH.split(delimiter)) {
      if (p.trim()) dirs.push(join(p.trim(), 'bin'));
    }
  }
  for (const d of dirs) {
    const c = join(d, binaryName);
    if (existsSync(c)) return c;
  }
  return null;
}
