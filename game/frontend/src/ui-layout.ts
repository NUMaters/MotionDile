/**
 * 左右反転：ジョイスティック・カメラプレビュー・視点リセット・コンパス・切替ボタンをミラー配置。
 * 待機 PiP カードも同じ設定で左右が入れ替わる（`app.css`）。
 * 3D ワールドとフルスクリーンオーバーレイ中央部はそのまま。
 */
const STORAGE_KEY = 'waniar:ui-layout-mirrored';

export function isUIMirrored(): boolean {
  return localStorage.getItem(STORAGE_KEY) === '1';
}

export function setUIMirrored(value: boolean): void {
  localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  applyShellClass();
  syncLayoutToggleButton();
  window.dispatchEvent(new CustomEvent('uilayoutchange'));
}

export function applyShellClass(): void {
  document.querySelector('.game-shell')?.classList.toggle('game-shell--ui-mirrored', isUIMirrored());
}

function syncLayoutToggleButton(): void {
  const btn = document.getElementById('btn-ui-layout');
  if (!btn) return;
  const mirrored = isUIMirrored();
  btn.setAttribute('aria-pressed', mirrored ? 'true' : 'false');
  btn.setAttribute(
    'aria-label',
    mirrored ? '操作UIを標準（左ジョイスティック・右上カメラ）に戻す' : '操作UIを左右反転（右ジョイスティック・左上カメラ）',
  );
  btn.setAttribute('title', mirrored ? '標準レイアウトに戻す' : '左右反転');
  btn.classList.toggle('btn-ui-layout--active', mirrored);
}

export function initUILayout(): void {
  applyShellClass();
  syncLayoutToggleButton();
  document.getElementById('btn-ui-layout')?.addEventListener('click', () => {
    setUIMirrored(!isUIMirrored());
  });
}
