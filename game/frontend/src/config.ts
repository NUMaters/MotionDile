/// <reference types="vite/client" />
import type { HandControlModel } from './types';

const appBaseUrl = new URL(import.meta.env.BASE_URL || '/', window.location.origin);

export const HAND_MODEL_URL = new URL('models/hand-control-model.json', appBaseUrl).href;
export const MODEL_URL = new URL('modeling/Wani_game.glb', appBaseUrl).href;
export const GAME_API_BASE = import.meta.env.VITE_GAME_API_BASE || '/game-api/v1';
export const GAME_WS_BASE = import.meta.env.VITE_GAME_WS_BASE
  || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/game-ws`;

export const roomId = new URLSearchParams(location.search).get('room') || 'lobby';

export const GROUND_Y = 0;
export const WANI_SCALE = 2;

export const TERRAIN_MIN_NORMAL_Y = 0.45;
export const MAX_STEP_UP = 0.22;
export const PLAYER_HEIGHT_OFFSET = 0.575;
export const PLAYER_GROUND_CLEARANCE = 0.018;
export const MATERIAL_002_SINK_OFFSET = 0.0022;
export const PLAYER_COLLISION_RADIUS = 0.045;
export const FLAT_WORLD_MODE = true;

export const CAM_HEIGHT = 0.03;
export const CAM_DISTANCE = 0.09;
export const CAM_LOOK_AHEAD = 1.30;
export const CAM_LOOK_HEIGHT = 0.14;

export const MOVE_SEND_INTERVAL = 66;
export const HAND_DETECT_INTERVAL = 33;

export const RUN_STRETCH_ENTER = 1.06;
export const RUN_STRETCH_EXIT = 1.01;
export const MOVE_ACCEL_SMOOTH = 11;
export const MOVE_DECEL_SMOOTH = 7;
export const TURN_INPUT_SMOOTH = 10;
export const RUN_BLEND_SMOOTH = 7;
export const IDLE_SWAY_SPEED = 0.2;
export const IDLE_BOB_AMOUNT = 0.00001;
export const IDLE_PITCH_AMOUNT = 0.03;
export const IDLE_ROLL_AMOUNT = 0.025;

export const JOYSTICK_RADIUS = 50;

export const CLIP_NAMES = [
  'Walk', 'Run', 'Idle',
  'Walk_MouthOpen', 'Run_MouthOpen', 'Idle_MouthOpen',
  'Attack', 'TailWag',
];

export const DEFAULT_HAND_CONTROL_MODEL: HandControlModel = {
  version: 1,
  mouth: { closedCurl: 0.35, openCurl: 0.8, openThreshold: 0.4 },
  neck: {
    neutralTilt: 0,
    yawGain: 1.0,
    maxYaw: 0.7,
    neutralPitchAngle: 0,
    pitchGain: -2.0,
    maxPitch: 0.5,
  },
};

export const BODY_TINT_MAP_BLEND = 0.88;
export const BODY_TINT_SOLID_BLEND = 0.78;
export const BODY_EMISSIVE_MUL = 0.35;
export const BODY_EMISSIVE_INTENSITY = 0.55;
export const TINT_SKIP_NAME =
  /tongue|mouth|gum|teeth|tooth|lip|inner|oral|palate|saliva|口|舌|歯|歯茎|唇|目|eye|pupil|iris/i;
