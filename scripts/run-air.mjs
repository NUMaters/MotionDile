import { existsSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const [, , targetDirArg] = process.argv;

if (!targetDirArg) {
  console.error('Usage: node scripts/run-air.mjs <service-dir>');
  process.exit(1);
}

const serviceDir = resolve(process.cwd(), targetDirArg);
const configPath = join(serviceDir, '.air.toml');
const binaryName = process.platform === 'win32' ? 'air.exe' : 'air';

if (!existsSync(configPath)) {
  console.error(`[air] config not found: ${configPath}`);
  process.exit(1);
}

function loadGoEnv() {
  const result = spawnSync('go', ['env', '-json', 'GOBIN', 'GOPATH'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return {};
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    return {};
  }
}

function resolveAirBinary() {
  const airBinOverride = process.env.AIR_BIN;
  if (airBinOverride && existsSync(airBinOverride)) {
    return airBinOverride;
  }

  const goEnv = loadGoEnv();
  const pathEntries = (process.env.PATH || '').split(delimiter).filter(Boolean);
  const goBinEntries = [];

  if (typeof goEnv.GOBIN === 'string' && goEnv.GOBIN.trim() !== '') {
    goBinEntries.push(goEnv.GOBIN.trim());
  }

  if (typeof goEnv.GOPATH === 'string' && goEnv.GOPATH.trim() !== '') {
    for (const goPathEntry of goEnv.GOPATH.split(delimiter)) {
      if (goPathEntry.trim() !== '') {
        goBinEntries.push(join(goPathEntry.trim(), 'bin'));
      }
    }
  }

  for (const candidateDir of [...pathEntries, ...goBinEntries]) {
    const candidatePath = join(candidateDir, binaryName);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
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
