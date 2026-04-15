export function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

export function getOrCreatePlayerId(): string {
  const key = 'waniar:player-id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const generated = `p-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(key, generated);
  return generated;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function smoothToward(current: number, target: number, dt: number, speed: number): number {
  return current + (target - current) * (1 - Math.exp(-speed * dt));
}

export function errorToText(err: unknown): string {
  if (!err) return 'unknown';
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && 'type' in err) return String(err.type);
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
