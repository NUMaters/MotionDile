import { getEl } from './utils';

const hudText = getEl<HTMLElement>('hud-text');
let handModelStatus = '手モデル: 読み込み中';
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
  hudText.textContent = `${handModelStatus} | ${multiplayerStatus}`;
}

export function refreshHud(): void {
  refresh();
}
