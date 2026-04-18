/**
 * HUD ステータス行は廃止済み。#hud-text は DOM に存在しない。
 * network.ts / hand-tracking.ts からの呼び出し互換のため API だけ残す (no-op)。
 */

export function setHandModelStatus(_status: string): void {
  /* no-op */
}

export function setMultiplayerStatus(_status: string): void {
  /* no-op */
}

export function refreshHud(): void {
  /* no-op */
}
