const displayNameById = new Map<string, string>();

export function setPlayerDisplayName(playerId: string, name: string): void {
  const t = name.trim();
  displayNameById.set(playerId, t || playerId.slice(0, 8));
}

export function setPlayerDisplayNamesFromSnapshot(players: { playerId: string; displayName?: string }[]): void {
  for (const p of players) {
    if (p.displayName) setPlayerDisplayName(p.playerId, p.displayName);
  }
}

export function resolveDisplayName(playerId: string): string {
  return displayNameById.get(playerId) || playerId.slice(0, 8);
}

const STORAGE_KEY = 'waniar:player-name';

export function getStoredPlayerName(): string {
  return (localStorage.getItem(STORAGE_KEY) || '').trim();
}

export function saveStoredPlayerName(name: string): void {
  const t = name.trim().slice(0, 16);
  if (t) localStorage.setItem(STORAGE_KEY, t);
  else localStorage.removeItem(STORAGE_KEY);
}

export function getJoinDisplayName(): string {
  const n = getStoredPlayerName();
  return n || 'プレイヤー';
}

/** 単体テスト用：表示名キャッシュを空にする */
export function resetDisplayNameCacheForTest(): void {
  displayNameById.clear();
}
