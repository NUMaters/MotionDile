import { getEl } from './utils';
import {
  JOYSTICK_RADIUS, RUN_STRETCH_ENTER,
  JOYSTICK_DOUBLE_TAP_MS, JOYSTICK_TAP_MAX_DURATION_MS,
  JOYSTICK_DOUBLE_TAP_MAX_DIST_PX, TOUCH_TAP_MAX_MOVE_PX,
  JOYSTICK_BASE_SIZE_PX, JOYSTICK_BASE_INSET_PX, JOYSTICK_THUMB_SIZE_PX,
  JOYSTICK_RING_OUTER_PX, JOYSTICK_RING_INSET_PX, JOYSTICK_RING_BORDER_PX,
} from './config';

export const keys: Record<string, boolean> = Object.create(null);
export let manualMouthOpen = false;
export let attackPending = false;

export function consumeAttack(): boolean {
  if (!attackPending) return false;
  attackPending = false;
  return true;
}

let jumpPending = false;
export function consumeJump(): boolean {
  if (!jumpPending) return false;
  jumpPending = false;
  return true;
}

export const joystick = {
  active: false,
  touchId: null as number | null,
  cx: 0,
  cy: 0,
  dx: 0,
  dy: 0,
  rawStretch: 0,
};

const jZone = getEl<HTMLElement>('joystick-zone');
const jRunRing = document.getElementById('joystick-run-ring');
const jBase = getEl<HTMLElement>('joystick-base');
const jThumb = getEl<HTMLElement>('joystick-thumb');

/** 画面全体のダブルタップでジャンプ（1本指・changedTouches ごと） */
const touchTrack = new Map<number, { x0: number; y0: number; t0: number; moved: boolean }>();
let jumpDoubleTapLastTime = 0;
let jumpDoubleTapLastX = 0;
let jumpDoubleTapLastY = 0;

function setJoystickThumbOffset(px: number, py: number) {
  jThumb.style.transform = `translate(${px}px, ${py}px)`;
}

/** `config.ts` の定数でジョイスティックの見た目サイズ・位置を適用 */
function applyJoystickLayoutFromConfig(): void {
  const s = `${JOYSTICK_BASE_SIZE_PX}px`;
  jBase.style.width = s;
  jBase.style.height = s;
  jBase.style.left = `${JOYSTICK_BASE_INSET_PX}px`;
  jBase.style.bottom = `${JOYSTICK_BASE_INSET_PX}px`;

  const t = `${JOYSTICK_THUMB_SIZE_PX}px`;
  jThumb.style.width = t;
  jThumb.style.height = t;
  const thumbInset = JOYSTICK_BASE_INSET_PX + (JOYSTICK_BASE_SIZE_PX - JOYSTICK_THUMB_SIZE_PX) / 2;
  jThumb.style.left = `${thumbInset}px`;
  jThumb.style.bottom = `${thumbInset}px`;

  if (jRunRing) {
    const r = `${JOYSTICK_RING_OUTER_PX}px`;
    jRunRing.style.width = r;
    jRunRing.style.height = r;
    jRunRing.style.left = `${JOYSTICK_RING_INSET_PX}px`;
    jRunRing.style.bottom = `${JOYSTICK_RING_INSET_PX}px`;
    jRunRing.style.borderWidth = `${JOYSTICK_RING_BORDER_PX}px`;
  }
}

function getJoystickCenter() {
  const rect = jBase.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function jStart(x: number, y: number, id: number) {
  joystick.active = true;
  joystick.touchId = id;
  const c = getJoystickCenter();
  joystick.cx = c.x;
  joystick.cy = c.y;
  joystick.dx = 0;
  joystick.dy = 0;
  jBase.classList.add('active');
  jMove(x, y);
}

function jMove(x: number, y: number) {
  const rawDx = x - joystick.cx;
  const rawDy = y - joystick.cy;
  const rawDist = Math.hypot(rawDx, rawDy);
  joystick.rawStretch = rawDist / JOYSTICK_RADIUS;

  let dx = rawDx;
  let dy = rawDy;
  if (rawDist > JOYSTICK_RADIUS) {
    dx = (rawDx / rawDist) * JOYSTICK_RADIUS;
    dy = (rawDy / rawDist) * JOYSTICK_RADIUS;
  }
  joystick.dx = dx / JOYSTICK_RADIUS;
  joystick.dy = dy / JOYSTICK_RADIUS;
  setJoystickThumbOffset(dx, dy);

  if (jRunRing) {
    jRunRing.classList.toggle('hot', joystick.rawStretch >= RUN_STRETCH_ENTER * 0.92);
  }
}

function jEnd() {
  joystick.active = false;
  joystick.touchId = null;
  joystick.dx = 0;
  joystick.dy = 0;
  joystick.rawStretch = 0;
  jBase.classList.remove('active');
  setJoystickThumbOffset(0, 0);
  if (jRunRing) jRunRing.classList.remove('hot');
}

export function getInputVector(): { ix: number; iz: number; len: number } {
  let ix = joystick.dx;
  let iz = joystick.dy;

  if (keys['KeyW'] || keys['ArrowUp']) iz -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) iz += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) ix += 1;

  const len = Math.sqrt(ix * ix + iz * iz);
  if (len > 1) { ix /= len; iz /= len; }
  return { ix, iz, len: Math.min(len, 1) };
}

export function initInput(): void {
  applyJoystickLayoutFromConfig();

  jZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (joystick.active) return;
    const t = e.changedTouches[0];
    jStart(t.clientX, t.clientY, t.identifier);
  }, { passive: false });

  jZone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === joystick.touchId) jMove(t.clientX, t.clientY);
    }
  }, { passive: false });

  jZone.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joystick.touchId) jEnd();
    }
  });
  jZone.addEventListener('touchcancel', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joystick.touchId) jEnd();
    }
  });

  const onTouchStartGlobal = (e: TouchEvent) => {
    const now = performance.now();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      touchTrack.set(t.identifier, {
        x0: t.clientX,
        y0: t.clientY,
        t0: now,
        moved: false,
      });
    }
  };
  const onTouchMoveGlobal = (e: TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const s = touchTrack.get(t.identifier);
      if (!s) continue;
      const d = Math.hypot(t.clientX - s.x0, t.clientY - s.y0);
      if (d > TOUCH_TAP_MAX_MOVE_PX) s.moved = true;
    }
  };
  const onTouchEndGlobal = (e: TouchEvent) => {
    const now = performance.now();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const s = touchTrack.get(t.identifier);
      touchTrack.delete(t.identifier);
      if (!s) continue;
      const duration = now - s.t0;
      const releaseDist = Math.hypot(t.clientX - s.x0, t.clientY - s.y0);
      const isTap =
        duration < JOYSTICK_TAP_MAX_DURATION_MS
        && !s.moved
        && releaseDist < TOUCH_TAP_MAX_MOVE_PX;
      if (!isTap) continue;

      if (jumpDoubleTapLastTime > 0 && now - jumpDoubleTapLastTime < JOYSTICK_DOUBLE_TAP_MS) {
        const dist = Math.hypot(t.clientX - jumpDoubleTapLastX, t.clientY - jumpDoubleTapLastY);
        if (dist < JOYSTICK_DOUBLE_TAP_MAX_DIST_PX) {
          jumpPending = true;
        }
        jumpDoubleTapLastTime = 0;
      } else {
        jumpDoubleTapLastTime = now;
        jumpDoubleTapLastX = t.clientX;
        jumpDoubleTapLastY = t.clientY;
      }
    }
  };

  document.addEventListener('touchstart', onTouchStartGlobal, { passive: true, capture: true });
  document.addEventListener('touchmove', onTouchMoveGlobal, { passive: true, capture: true });
  document.addEventListener('touchend', onTouchEndGlobal, { passive: true, capture: true });
  document.addEventListener('touchcancel', (ev) => {
    for (let i = 0; i < ev.changedTouches.length; i++) {
      touchTrack.delete(ev.changedTouches[i].identifier);
    }
  }, { passive: true, capture: true });

  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'KeyM') manualMouthOpen = !manualMouthOpen;
    if (e.code === 'Space') jumpPending = true;
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  setJoystickThumbOffset(0, 0);
}
