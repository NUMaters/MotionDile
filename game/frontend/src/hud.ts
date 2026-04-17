/** 画面上部のステータス行は廃止。#hud-text が無い場合は何もしない（互換 API のみ）。 */
const hudText = document.getElementById('hud-text') as HTMLElement | null;

let handModelStatus = '手: MediaPipe（カメラ前）';
let multiplayerStatus = '';

export function setHandModelStatus(status: string): void {
  handModelStatus = status;
  refresh();
}

export function setMultiplayerStatus(status: string): void {
  multiplayerStatus = status;
  refresh();
}

function refresh(): void {
  if (!hudText) return;
  hudText.textContent = `${handModelStatus} | ${multiplayerStatus}`;
}

export function refreshHud(): void {
  refresh();
}
