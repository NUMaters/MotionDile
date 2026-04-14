import { getEl } from './utils';
import { JOYSTICK_RADIUS, RUN_STRETCH_ENTER } from './config';

export const keys: Record<string, boolean> = Object.create(null);
export let manualMouthOpen = false;
export let attackPending = false;

export function consumeAttack(): boolean {
  if (!attackPending) return false;
  attackPending = false;
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

function setJoystickThumbOffset(px: number, py: number) {
  jThumb.style.transform = `translate(${px}px, ${py}px)`;
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

  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'KeyM') manualMouthOpen = !manualMouthOpen;
    if (e.code === 'Space') { e.preventDefault(); attackPending = true; }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  setJoystickThumbOffset(0, 0);
}
