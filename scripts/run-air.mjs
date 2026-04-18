import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import { resolveAirBinary } from './resolve-air.mjs';

const [, , targetDirArg] = process.argv;

if (!targetDirArg) {
  console.error('Usage: node scripts/run-air.mjs <service-dir>');
  process.exit(1);
}

const serviceDir = resolve(process.cwd(), targetDirArg);
const configPath = join(serviceDir, '.air.toml');

if (!existsSync(configPath)) {
  console.error(`[air] config not found: ${configPath}`);
  process.exit(1);
}

const airBinary = resolveAirBinary();

if (!airBinary) {
  console.error('[air] executable not found.');
  console.error('[air] Install it with: go install github.com/air-verse/air@latest');
  process.exit(1);
}

const child = spawn(airBinary, ['-c', '.air.toml'], {
  cwd: serviceDir,
  env: process.env,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
