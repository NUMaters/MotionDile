/**
 * 試合結果オーバーレイ用の紙吹雪（DOM + CSS アニメーション。依存パッケージなし）
 */
const LAYER_ID = 'result-confetti-layer';

const COLORS_WIN = ['#7ee2a8', '#f0c040', '#58a6ff', '#ffa657', '#ff7eb3', '#e6edf3', '#3fb950', '#79c0ff'];

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function clearResultConfetti(): void {
  document.getElementById(LAYER_ID)?.replaceChildren();
}

/** 勝利時のみ祝賀の紙吹雪を出す（敗北時は不自然になるため非表示） */
export function spawnResultConfetti(win: boolean): void {
  clearResultConfetti();
  if (!win || prefersReducedMotion()) return;

  const layer = document.getElementById(LAYER_ID);
  if (!layer) return;

  const palette = COLORS_WIN;
  const count = 76;
  const frag = document.createDocumentFragment();

  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'result-confetti-piece';
    el.setAttribute('aria-hidden', 'true');
    el.style.left = `${Math.random() * 100}%`;
    el.style.top = '-6%';
    el.style.background = palette[Math.floor(Math.random() * palette.length)] ?? '#e6edf3';
    const w = 5 + Math.random() * 7;
    const h = 2.5 + Math.random() * 5;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.borderRadius = Math.random() > 0.45 ? '2px' : '1px';
    el.style.setProperty('--dur', `${2.2 + Math.random() * 2.6}s`);
    el.style.setProperty('--delay', `${Math.random() * 1.4}s`);
    el.style.setProperty('--drift', `${(Math.random() - 0.5) * 220}px`);
    el.style.setProperty('--rot-end', `${360 + Math.random() * 900}deg`);
    frag.appendChild(el);
  }
  layer.appendChild(frag);
}
